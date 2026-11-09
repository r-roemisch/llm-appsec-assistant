"""Feedback: a thumbs up or down, with an optional comment, on a user's own assistant answer.

Capture only. Feedback is stored with the answer's trace id and the Tools it used, forwarded as
a score to the trace (Langfuse, or the local JSONL trace log), listed for admins, and can be
turned into an Evaluation Case by an admin. Nothing here reads or writes policy, Guards, Slots,
prompts or retrieval; ``tests/test_feedback.py`` fingerprints both to prove it (A18).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from rampart.db import utcnow
from rampart.errors import Conflict, Invalid, NotFound
from rampart.guards.secrets import redact
from rampart.models import Conversation, EvaluationCase, Feedback, Message, User
from rampart.tracing import Tracer

log = logging.getLogger(__name__)

SCORE_NAME = "user_feedback"
MAX_COMMENT = 1000
UNFINISHED = ("streaming", "awaiting_approval")
KINDS = ("qa", "tool")


@dataclass(frozen=True)
class FeedbackRecord:
    """One Feedback row as the admin dashboard shows it."""

    feedback: Feedback
    answer: Message
    question: str | None
    username: str | None


@dataclass(frozen=True)
class FeedbackTotals:
    up: int
    down: int
    converted: int


class FeedbackService:
    def __init__(self, db: Session, tracer: Tracer | None = None) -> None:
        self.db = db
        self.tracer = tracer

    # ---- the user's side ---------------------------------------------------------------------

    def _own_answer(self, user_id: int, message_id: str) -> Message:
        message = self.db.get(Message, message_id)
        conversation = self.db.get(Conversation, message.conversation_id) if message else None
        if (
            message is None
            or message.role != "assistant"
            or conversation is None
            or conversation.user_id != user_id
        ):
            raise NotFound("there is no such answer")  # never reveal another user's message
        if message.status in UNFINISHED:
            raise Conflict("the answer is not finished yet")
        return message

    def set(self, user: User, message_id: str, value: int, comment: str | None) -> Feedback:
        if value not in (1, -1):
            raise Invalid("value must be 1 or -1")
        message = self._own_answer(user.id, message_id)
        text = (comment or "").strip()[:MAX_COMMENT]
        row = self.db.scalar(
            select(Feedback).where(Feedback.message_id == message_id, Feedback.user_id == user.id)
        )
        if row is None:
            row = Feedback(message_id=message_id, user_id=user.id, value=value)
            self.db.add(row)
        row.value = value
        row.comment = redact(text).text if text else None  # no pasted secret reaches admins
        row.trace_id = message.trace_id
        row.tools_used = list(
            dict.fromkeys(str(c["tool"]) for c in message.tool_calls or [] if c.get("tool"))
        )
        row.updated_at = utcnow()
        self.db.flush()
        self._forward(row)
        return row

    def delete(self, user: User, message_id: str) -> None:
        self._own_answer(user.id, message_id)
        row = self.db.scalar(
            select(Feedback).where(Feedback.message_id == message_id, Feedback.user_id == user.id)
        )
        if row is not None:
            self.db.delete(row)

    def mine(self, user_id: int, message_ids: list[str]) -> dict[str, Feedback]:
        if not message_ids:
            return {}
        rows = self.db.scalars(
            select(Feedback).where(
                Feedback.user_id == user_id, Feedback.message_id.in_(message_ids)
            )
        )
        return {r.message_id: r for r in rows}

    def _forward(self, row: Feedback) -> None:
        """Send the Feedback to the trace as a score. The Feedback's id is the score id, so a
        changed thumb updates the score instead of adding a second one."""
        if self.tracer is None or not row.trace_id:
            return
        try:
            self.tracer.score(
                trace_id=row.trace_id,
                name=SCORE_NAME,
                value=float(row.value),
                comment=row.comment,
                score_id=row.id,
            )
        except Exception:  # tracing must never break the user's action
            log.warning("could not forward Feedback %s as a score", row.id, exc_info=True)
            return
        row.forwarded_at = utcnow()
        row.forwarded_to = self.tracer.backend

    # ---- the admin's side --------------------------------------------------------------------

    def totals(self) -> FeedbackTotals:
        def count(*where) -> int:
            return self.db.scalar(select(func.count(Feedback.id)).where(*where)) or 0

        return FeedbackTotals(
            up=count(Feedback.value == 1),
            down=count(Feedback.value == -1),
            converted=count(Feedback.evaluation_case_id.is_not(None)),
        )

    def records(self, value: int | None = None, limit: int = 200) -> list[FeedbackRecord]:
        query = select(Feedback).order_by(Feedback.updated_at.desc()).limit(limit)
        if value is not None:
            query = query.where(Feedback.value == value)
        found: list[FeedbackRecord] = []
        for row in self.db.scalars(query):
            answer = self.db.get(Message, row.message_id)
            if answer is None:
                continue
            user = self.db.get(User, row.user_id)
            found.append(
                FeedbackRecord(
                    row, answer, self._question_for(answer), user.username if user else None
                )
            )
        return found

    def _question_for(self, answer: Message) -> str | None:
        """The user message the answer replied to: the latest one before it."""
        return self.db.scalar(
            select(Message.content)
            .where(
                Message.conversation_id == answer.conversation_id,
                Message.role == "user",
                Message.created_at <= answer.created_at,
            )
            .order_by(Message.created_at.desc())
            .limit(1)
        )

    def convert(
        self,
        admin: User,
        feedback_id: str,
        *,
        kind: str,
        question: str,
        expected_answer: str | None,
        expected_tools: list[str] | None,
        known_tools: set[str],
    ) -> EvaluationCase:
        """Turn an answer with Feedback into an Evaluation Case, reviewed and edited by the admin:
        the question as it should be asked, and the expected answer or the expected Tools."""
        row = self.db.get(Feedback, feedback_id)
        if row is None:
            raise NotFound("there is no such Feedback")
        if row.evaluation_case_id is not None:
            raise Conflict(f"this Feedback is already Evaluation Case {row.evaluation_case_id}")
        if kind not in KINDS:
            raise Invalid("kind must be qa or tool")
        question = question.strip()
        if not question:
            raise Invalid("the question must not be empty")
        answer_text = (expected_answer or "").strip()
        tools = list(dict.fromkeys(t.strip() for t in expected_tools or [] if t.strip()))
        if kind == "qa" and not answer_text:
            raise Invalid("a qa case needs the expected answer")
        if kind == "tool":
            if not tools:
                raise Invalid("a tool case needs at least one expected Tool")
            unknown = [t for t in tools if t not in known_tools]
            if unknown:
                raise Invalid(f"unknown Tool: {', '.join(unknown)}")
        case = EvaluationCase(
            kind=kind,
            question=redact(question).text,
            expected_answer=redact(answer_text).text if kind == "qa" else None,
            expected_tools=tools if kind == "tool" else None,
            source=f"feedback:{row.id}",
            created_by=admin.id,
        )
        self.db.add(case)
        self.db.flush()
        row.evaluation_case_id = case.id
        return case

    def cases(self) -> list[EvaluationCase]:
        return list(self.db.scalars(select(EvaluationCase).order_by(EvaluationCase.created_at)))

    def delete_case(self, case_id: str) -> None:
        case = self.db.get(EvaluationCase, case_id)
        if case is None:
            raise NotFound("there is no such Evaluation Case")
        self.db.delete(case)  # the Feedback it came from keeps existing, unlinked
