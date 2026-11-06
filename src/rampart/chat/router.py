"""Conversations: list, create, read, rename, delete, and stream a turn as server-sent events."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session
from sse_starlette import EventSourceResponse, ServerSentEvent

from rampart.chat.service import ChatService
from rampart.deps import csrf_protect, current_user, get_db
from rampart.models import User
from rampart.schemas import (
    ConversationCreateIn,
    ConversationDetailOut,
    ConversationOut,
    ConversationUpdateIn,
    MessageIn,
    conversation_out,
    message_out,
)

router = APIRouter(
    prefix="/api/conversations",
    tags=["conversations"],
    dependencies=[Depends(current_user), Depends(csrf_protect)],
)


def get_chat(request: Request) -> ChatService:
    return request.app.state.chat


@router.get("", response_model=list[ConversationOut])
def list_conversations(
    user: User = Depends(current_user),
    chat: ChatService = Depends(get_chat),
    db: Session = Depends(get_db),
) -> list[ConversationOut]:
    return [
        conversation_out(c, s.message_count, s.total_cost_usd)
        for c, s in chat.list_conversations(db, user.id)
    ]


@router.post("", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
def create_conversation(
    body: ConversationCreateIn,
    user: User = Depends(current_user),
    chat: ChatService = Depends(get_chat),
    db: Session = Depends(get_db),
) -> ConversationOut:
    conversation, stats = chat.create_conversation(db, user.id, body.model_id, body.title)
    db.commit()
    return conversation_out(conversation, stats.message_count, stats.total_cost_usd)


@router.get("/{conversation_id}", response_model=ConversationDetailOut)
def get_conversation(
    conversation_id: str,
    user: User = Depends(current_user),
    chat: ChatService = Depends(get_chat),
    db: Session = Depends(get_db),
) -> ConversationDetailOut:
    conversation, stats, messages = chat.get_detail(db, user.id, conversation_id)
    return ConversationDetailOut(
        conversation=conversation_out(conversation, stats.message_count, stats.total_cost_usd),
        messages=[message_out(m) for m in messages],
    )


@router.patch("/{conversation_id}", response_model=ConversationOut)
def update_conversation(
    conversation_id: str,
    body: ConversationUpdateIn,
    user: User = Depends(current_user),
    chat: ChatService = Depends(get_chat),
    db: Session = Depends(get_db),
) -> ConversationOut:
    conversation, stats = chat.update_conversation(
        db, user.id, conversation_id, title=body.title, model_id=body.model_id
    )
    db.commit()
    return conversation_out(conversation, stats.message_count, stats.total_cost_usd)


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: str,
    user: User = Depends(current_user),
    chat: ChatService = Depends(get_chat),
    db: Session = Depends(get_db),
) -> Response:
    chat.delete_conversation(db, user.id, conversation_id)
    db.commit()
    await chat.engine.delete_thread(conversation_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    body: MessageIn,
    user: User = Depends(current_user),
    chat: ChatService = Depends(get_chat),
) -> EventSourceResponse:
    turn = chat.stream_turn(user_id=user.id, conversation_id=conversation_id, content=body.content)
    # Run the generator up to its first event here so that validation errors (empty message,
    # busy Conversation, unknown Conversation) become ordinary HTTP errors, not a broken stream.
    first = await turn.__anext__()

    async def events():
        yield ServerSentEvent(event=first.event, data=json.dumps(first.data))
        async for item in turn:
            yield ServerSentEvent(event=item.event, data=json.dumps(item.data))

    return EventSourceResponse(events())
