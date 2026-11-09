"""Knowledge Base endpoints (status, Sources, uploads, passages) and the help documents."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from rampart.deps import csrf_protect, current_user, get_db
from rampart.errors import Invalid
from rampart.knowledge.service import KnowledgeService
from rampart.knowledge.sources import APP_DOCS
from rampart.models import User
from rampart.schemas import HelpDocOut, KnowledgeStatusOut, PassageOut, SourceOut

MULTIPART_OVERHEAD = 64 * 1024

router = APIRouter(
    prefix="/api/knowledge",
    tags=["knowledge"],
    dependencies=[Depends(current_user), Depends(csrf_protect)],
)
help_router = APIRouter(prefix="/api/help", tags=["help"], dependencies=[Depends(current_user)])


def get_knowledge(request: Request) -> KnowledgeService:
    return request.app.state.knowledge


@router.get("/status", response_model=KnowledgeStatusOut)
def knowledge_status(
    user: User = Depends(current_user),
    knowledge: KnowledgeService = Depends(get_knowledge),
    db: Session = Depends(get_db),
) -> KnowledgeStatusOut:
    return KnowledgeStatusOut.model_validate(knowledge.status(db, user.id))


@router.get("/sources", response_model=list[SourceOut])
def list_sources(
    user: User = Depends(current_user),
    knowledge: KnowledgeService = Depends(get_knowledge),
    db: Session = Depends(get_db),
) -> list[SourceOut]:
    return [SourceOut.model_validate(view) for view in knowledge.list_sources(db, user.id)]


@router.post(
    "/uploads",
    response_model=SourceOut,
    status_code=status.HTTP_201_CREATED,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["file"],
                        "properties": {"file": {"type": "string", "format": "binary"}},
                    }
                }
            },
        }
    },
)
async def upload(
    request: Request,
    user: User = Depends(current_user),
    knowledge: KnowledgeService = Depends(get_knowledge),
) -> SourceOut:
    # The body is parsed here, after the session and CSRF checks, and only when its declared
    # size fits the limit, so an anonymous or oversized request is refused before it is read.
    limit = knowledge.settings.max_upload_bytes
    declared = request.headers.get("content-length")
    if declared is None or not declared.isdigit():
        raise Invalid("the upload must declare its size (Content-Length)")
    if int(declared) > limit + MULTIPART_OVERHEAD:
        raise Invalid(f"the file is larger than the {limit / (1024 * 1024):g} MB upload limit")
    if not request.headers.get("content-type", "").startswith("multipart/form-data"):
        raise Invalid("send the file as multipart/form-data in a field named 'file'")
    form = await request.form(max_files=1, max_fields=2)
    try:
        item = form.get("file")
        if not isinstance(item, UploadFile):
            raise Invalid("send the file in a form field named 'file'")
        data = await item.read(limit + 1)
        view = await knowledge.upload(user.id, item.filename or "upload", data)
    finally:
        await form.close()
    return SourceOut.model_validate(view)


@router.delete("/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_source(
    source_id: str,
    user: User = Depends(current_user),
    knowledge: KnowledgeService = Depends(get_knowledge),
) -> Response:
    await knowledge.delete_source(user.id, source_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/passages/{passage_id}", response_model=PassageOut)
def get_passage(
    passage_id: str,
    user: User = Depends(current_user),
    knowledge: KnowledgeService = Depends(get_knowledge),
    db: Session = Depends(get_db),
) -> PassageOut:
    return PassageOut.model_validate(knowledge.get_passage(db, user.id, passage_id))


_H1 = re.compile(r"^#\s+(.+?)\s*$", re.MULTILINE)


@help_router.get("/docs", response_model=list[HelpDocOut])
def help_docs(knowledge: KnowledgeService = Depends(get_knowledge)) -> list[HelpDocOut]:
    docs: list[HelpDocOut] = []
    for name, audience in APP_DOCS:
        path = knowledge.settings.docs_dir / name
        if not path.is_file():
            continue
        markdown = path.read_text(encoding="utf-8")
        match = _H1.search(markdown)
        docs.append(
            HelpDocOut(
                slug=name.removesuffix(".md"),
                title=match.group(1).strip() if match else name,
                audience=audience,  # type: ignore[arg-type]
                markdown=markdown,
            )
        )
    return docs
