"""Evaluation runs: the estimate shown before a run, runs recorded in the database, executing a
run's suite, and the list the admin page shows.

A suite executes in the process that asked for it (the CLI), or in a subprocess the admin page
starts, so DeepEval and its side effects stay out of the web server. A run is queued, then
running, then done or failed; a run whose process disappeared is marked failed when listed.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from rampart.catalog.catalog import Catalog
from rampart.catalog.providers import LiveProbe, ProviderProbe
from rampart.catalog.service import CatalogService, SlotConfig
from rampart.chat.llm import ChatModelFactory, GenerationSettings, ProviderChatModelFactory
from rampart.config import Settings
from rampart.db import init_db, make_engine, make_session_factory, session_scope, utcnow
from rampart.errors import Conflict, NotFound
from rampart.eval import guard, report
from rampart.eval.datasets import QaCase, ToolCase, guard_cases, qa_cases, tool_cases
from rampart.eval.estimate import SuiteEstimate, estimate
from rampart.eval.pricing import Price, fetch_prices
from rampart.eval.scoring import (
    QA_METRICS,
    TOOL_METRICS,
    CaseResult,
    MetricsFactory,
    deepeval_qa_metrics,
    score_qa,
    score_tools,
    summarise,
)
from rampart.eval.turns import TurnRecord, collect
from rampart.models import EvalRun

SUITES = ("qa", "tool", "guard")
KINDS = {"qa": "deepeval_qa", "tool": "deepeval_tool", "guard": "guard"}
SUITE_OF = {kind: suite for suite, kind in KINDS.items()}
ACTIVE = ("queued", "running")

Progress = Callable[[str], None]


def _alive(pid: int | None) -> bool:
    if pid is None:
        return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class EvalService:
    def __init__(
        self,
        settings: Settings,
        session_factory: sessionmaker[Session],
        catalog: Catalog,
        probe: ProviderProbe,
        *,
        model_factory: ChatModelFactory | None = None,
        prices: Callable[[], dict[str, Price]] | None = None,
        qa_metrics: MetricsFactory | None = None,
    ) -> None:
        self.settings = settings
        self.session_factory = session_factory
        self.catalog = catalog
        self.probe = probe
        self._model_factory = model_factory
        self._fetch_prices = prices or fetch_prices
        self._price_cache: tuple[float, dict[str, Price]] | None = None
        self.qa_metrics = qa_metrics or deepeval_qa_metrics

    @classmethod
    def from_settings(cls, settings: Settings) -> EvalService:
        engine = make_engine(settings.database_path)
        init_db(engine)
        return cls(
            settings,
            make_session_factory(engine),
            Catalog.load(settings.models_file),
            LiveProbe(settings),
        )

    @property
    def model_factory(self) -> ChatModelFactory:
        if self._model_factory is None:
            self._model_factory = ProviderChatModelFactory(self.settings)
        return self._model_factory

    # ---- estimates -----------------------------------------------------------------------------

    def _prices(self) -> dict[str, Price]:
        """OpenRouter's listing, kept for an hour."""
        now = time.monotonic()
        if self._price_cache is None or now - self._price_cache[0] > 3600:
            self._price_cache = (now, self._fetch_prices())
        return self._price_cache[1]

    def _slots(self, db: Session) -> dict[str, SlotConfig]:
        service = CatalogService(db, self.catalog, self.probe)
        return {slot: service.slot_config(slot) for slot in ("chat", "grader", "judge")}

    def _cases(self, suite: str, db: Session, limit: int | None) -> list[Any]:
        if suite == "qa":
            found: list[Any] = qa_cases(self.settings.eval_dir, db)
        elif suite == "tool":
            found = tool_cases(self.settings.eval_dir, db)
        else:
            found = guard_cases(self.settings.eval_dir) + guard_cases(
                self.settings.eval_dir, holdout=True
            )
        return found if limit is None or suite == "guard" else found[:limit]

    def estimates(self, suites: tuple[str, ...], limit: int | None = None) -> list[SuiteEstimate]:
        prices: dict[str, Price] = {}
        price_note: str | None = None
        if any(s != "guard" for s in suites):
            try:
                prices = self._prices()
            except Exception as exc:
                price_note = f"OpenRouter's price listing could not be read ({type(exc).__name__})"
        found: list[SuiteEstimate] = []
        with session_scope(self.session_factory) as db:
            slots = self._slots(db)
            for suite in suites:
                result = estimate(
                    suite,
                    len(self._cases(suite, db, limit)),
                    chat=slots["chat"].model,
                    grader=slots["grader"].model,
                    judge=slots["judge"].model,
                    prices=prices,
                )
                if price_note and suite != "guard":
                    result.notes.append(price_note)
                found.append(result)
        return found

    # ---- runs ----------------------------------------------------------------------------------

    def create_runs(
        self,
        estimates: list[SuiteEstimate],
        *,
        limit: int | None,
        started_by: int | None,
        pid: int | None = None,
    ) -> list[str]:
        ids: list[str] = []
        with session_scope(self.session_factory) as db:
            for e in estimates:
                row = EvalRun(
                    kind=KINDS[e.suite],
                    status="queued",
                    judge_model=e.judge_model,
                    estimated_cost_usd=e.cost_usd,
                    case_count=e.cases,
                    case_limit=limit if e.suite != "guard" else None,
                    started_by=started_by,
                    pid=pid,
                )
                db.add(row)
                db.flush()
                ids.append(row.id)
        return ids

    def refresh(self, db: Session) -> None:
        """Mark runs whose process is gone as failed."""
        for row in db.scalars(select(EvalRun).where(EvalRun.status.in_(ACTIVE))):
            if not _alive(row.pid):
                row.status = "failed"
                row.error = "the run stopped before it finished"
                row.finished_at = utcnow()

    def runs(self, db: Session, limit: int = 100) -> list[EvalRun]:
        self.refresh(db)
        return list(db.scalars(select(EvalRun).order_by(EvalRun.created_at.desc()).limit(limit)))

    def get(self, db: Session, run_id: str) -> EvalRun:
        self.refresh(db)
        row = db.get(EvalRun, run_id)
        if row is None:
            raise NotFound("there is no such evaluation run")
        return row

    def ensure_idle(self, db: Session) -> None:
        self.refresh(db)
        active = db.scalar(select(EvalRun).where(EvalRun.status.in_(ACTIVE)).limit(1))
        if active is not None:
            raise Conflict("an evaluation run is already in progress")

    # ---- execution -----------------------------------------------------------------------------

    def execute(self, run_id: str, progress: Progress | None = None) -> EvalRun:
        with session_scope(self.session_factory) as db:
            row = db.get(EvalRun, run_id)
            if row is None:
                raise NotFound("there is no such evaluation run")
            row.status = "running"
            row.pid = os.getpid()
            suite, limit, estimated = SUITE_OF[row.kind], row.case_limit, row.estimated_cost_usd
        started = datetime.now(UTC)
        try:
            payload = self._run_suite(suite, limit, run_id, progress)
            payload.update(
                {
                    "run_id": run_id,
                    "suite": suite,
                    "kind": KINDS[suite],
                    "started_at": started.isoformat(),
                    "finished_at": datetime.now(UTC).isoformat(),
                    "estimate": {"cost_usd": estimated},
                }
            )
            md_path, _json = report.write(payload, self.settings.eval_reports_dir)
        except Exception as exc:
            with session_scope(self.session_factory) as db:
                row = db.get(EvalRun, run_id)
                assert row is not None
                row.status = "failed"
                row.error = f"{type(exc).__name__}: {exc}"[:2000]
                row.finished_at = utcnow()
            raise
        with session_scope(self.session_factory) as db:
            row = db.get(EvalRun, run_id)
            assert row is not None
            row.status = "done"
            row.metrics = payload["metrics"]
            row.cost_usd = payload["cost"]["total_usd"]
            row.case_count = payload["dataset"]["cases"]
            row.report_path = str(md_path)
            row.finished_at = utcnow()
            db.flush()
            db.expunge(row)
        return row

    def _run_suite(
        self, suite: str, limit: int | None, run_id: str, progress: Progress | None
    ) -> dict[str, Any]:
        if suite == "guard":
            metrics = guard.run(self.settings.eval_dir)
            written, held = metrics["cases"], metrics["holdout"]
            n = written["adversarial"] + written["benign"]
            m = held["adversarial"] + held["benign"]
            return {
                "models": {},
                "metrics": metrics,
                "cases": [],
                "dataset": {"cases": n + m, "authored": n + m, "added": 0, "limit": None},
                "dataset_line": f"{n} written with the rules, {m} held out",
                "cost": {
                    "total_usd": 0.0,
                    "turns_usd": 0.0,
                    "judge_usd": 0.0,
                    "unknown_cost_calls": 0,
                },
            }
        with session_scope(self.session_factory) as db:
            cases = self._cases(suite, db, limit)
            slots = self._slots(db)
        say = progress or (lambda _line: None)

        def on_turn(index: int, total: int, record: TurnRecord) -> None:
            extra = (
                f", {len(record.contexts)} passages"
                if suite == "qa"
                else f", tools {record.tools_called or '-'}"
            )
            say(f"  [{index}/{total}] {record.case_id}: {record.status}{extra}")

        if suite == "qa":  # fail before any turn is paid for if the judge cannot answer
            say(f"qa: checking that the judge {slots['judge'].model.id} answers")
            asyncio.run(self._preflight(slots["judge"]))
        say(f"{suite}: asking {len(cases)} questions on a snapshot of the Knowledge Base")
        records = collect(
            self.settings,
            [(c.id, c.question) for c in cases],
            model_factory=self.model_factory,
            probe=self.probe,
            catalog=self.catalog,
            register_target=suite == "tool",
            progress=on_turn,
        )
        turns_usd = sum(r.cost_usd or 0.0 for r in records)
        unknown = sum(1 for r in records if r.cost_usd is None and r.status != "error")
        judge_usd, judge_calls, judge_model = 0.0, 0, None
        judge_tokens = (0, 0)
        from rampart.eval.judge import CostLedger, prepare_deepeval_env

        prepare_deepeval_env(self.settings.eval_work_dir / "deepeval")
        if suite == "qa":
            judge_slot = slots["judge"]
            judge_model = judge_slot.model.id
            ledger = CostLedger(
                self.settings.openrouter_api_key.get_secret_value()
                if self.settings.openrouter_api_key
                else None
            )
            say(f"qa: judging with {judge_model}")
            results = asyncio.run(self._judge(records, cases, judge_slot, ledger))
            judge_usd, judge_calls, unknown = (
                ledger.cost_usd,
                ledger.calls,
                unknown + ledger.unknown_cost_calls,
            )
            judge_tokens = (ledger.input_tokens, ledger.output_tokens)
            names = QA_METRICS
        else:
            results = asyncio.run(score_tools(records, cases))
            names = TOOL_METRICS
        authored = sum(c.source == "authored" for c in cases)
        line = f"{len(cases)} ({authored} authored, {len(cases) - authored} added from Feedback)"
        if limit is not None:
            line += f"; the first {limit} only"
        return {
            "models": {
                "chat": slots["chat"].model.id,
                "grader": slots["grader"].model.id,
                "judge": judge_model,
            },
            "threshold": self.settings.eval_threshold if suite == "qa" else 1.0,
            "metrics": summarise(results, names),
            "cases": report.public_cases([r.as_dict() for r in results]),
            "dataset": {
                "cases": len(cases),
                "authored": authored,
                "added": len(cases) - authored,
                "limit": limit,
            },
            "dataset_line": line,
            "cost": {
                "total_usd": round(turns_usd + judge_usd, 6),
                "turns_usd": round(turns_usd, 6),
                "judge_usd": round(judge_usd, 6),
                "judge_calls": judge_calls,
                "judge_input_tokens": judge_tokens[0],
                "judge_output_tokens": judge_tokens[1],
                "unknown_cost_calls": unknown,
            },
        }

    async def _preflight(self, slot: SlotConfig) -> None:
        from langchain_core.messages import HumanMessage

        llm = self.model_factory.build(slot.model, GenerationSettings(None, 16), purpose="grader")
        try:
            await llm.ainvoke([HumanMessage(content="Reply with the single word OK.")])
        except Exception as exc:
            raise RuntimeError(
                f"the judge Model {slot.model.id} could not be used, so no turns were run: "
                f"{type(exc).__name__}: {str(exc)[:300]}"
            ) from exc
        finally:
            close = getattr(self.model_factory, "aclose", None)
            if close is not None:
                await close()

    async def _judge(
        self,
        records: list[TurnRecord],
        cases: list[QaCase | ToolCase],
        slot: SlotConfig,
        ledger: Any,
    ) -> list[CaseResult]:
        from rampart.eval.judge import build_judge

        llm = self.model_factory.build(
            slot.model, GenerationSettings(slot.temperature, slot.max_tokens), purpose="grader"
        )
        judge = build_judge(llm, slot.model, ledger)
        try:
            return await score_qa(
                records,
                [c for c in cases if isinstance(c, QaCase)],
                judge=judge,
                threshold=self.settings.eval_threshold,
                concurrency=self.settings.eval_concurrency,
                metrics_factory=self.qa_metrics,
            )
        finally:
            close = getattr(self.model_factory, "aclose", None)
            if close is not None:
                await close()


class SubprocessLauncher:
    """Starts ``python -m rampart.eval run <ids>`` for runs the admin page queued, with the same
    data folder, catalog and datasets as the server, and watches it: a run left unfinished when
    the process exits is marked failed."""

    def __init__(self, settings: Settings, session_factory: sessionmaker[Session]) -> None:
        self.settings = settings
        self.session_factory = session_factory

    def __call__(self, run_ids: list[str]) -> None:
        s = self.settings
        env = {
            **os.environ,
            "RAMPART_DATA_DIR": str(s.data_dir.resolve()),
            "RAMPART_MODELS_FILE": str(s.models_file.resolve()),
            "RAMPART_EVAL_DIR": str(s.eval_dir.resolve()),
            "RAMPART_EVAL_REPORTS_DIR": str(s.eval_reports_dir.resolve()),
            "RAMPART_PLUGINS_CATALOG": str(s.plugins_catalog_path.resolve()),
        }
        if s.openrouter_api_key is not None:
            env["OPENROUTER_API_KEY"] = s.openrouter_api_key.get_secret_value()
        s.eval_work_dir.mkdir(parents=True, exist_ok=True)
        log = (s.eval_work_dir / f"run-{run_ids[0][:8]}.log").open("ab")
        process = subprocess.Popen(
            [sys.executable, "-m", "rampart.eval", "run", *run_ids],
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        with session_scope(self.session_factory) as db:
            for row in db.scalars(select(EvalRun).where(EvalRun.id.in_(run_ids))):
                row.pid = process.pid
        threading.Thread(target=self._watch, args=(process, run_ids, log), daemon=True).start()

    def _watch(self, process: subprocess.Popen[bytes], run_ids: list[str], log: Any) -> None:
        code = process.wait()
        log.close()
        with session_scope(self.session_factory) as db:
            for row in db.scalars(select(EvalRun).where(EvalRun.id.in_(run_ids))):
                if row.status in ACTIVE:
                    row.status = "failed"
                    row.error = f"the evaluation process exited with code {code} before finishing"
                    row.finished_at = utcnow()
