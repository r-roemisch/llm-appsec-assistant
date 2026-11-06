"""The FastAPI application: services wired together, the API routers, and the SPA files."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from langgraph.checkpoint.base import BaseCheckpointSaver

from rampart import __version__
from rampart.auth import router as auth_routes
from rampart.catalog import router as catalog_routes
from rampart.catalog.catalog import Catalog
from rampart.catalog.providers import LiveProbe, ProviderProbe
from rampart.chat import router as chat_routes
from rampart.chat.engine import ChatEngine
from rampart.chat.llm import ChatModelFactory, ProviderChatModelFactory
from rampart.chat.service import ChatService
from rampart.config import Settings, load_settings
from rampart.db import init_db, make_engine, make_session_factory
from rampart.errors import RampartError
from rampart.schemas import HealthOut
from rampart.tracing import Tracer, build_tracer
from rampart.usage import router as usage_routes

REPO_ROOT = Path(__file__).resolve().parents[2]


def create_app(
    settings: Settings | None = None,
    *,
    catalog: Catalog | None = None,
    probe: ProviderProbe | None = None,
    model_factory: ChatModelFactory | None = None,
    checkpointer: BaseCheckpointSaver | None = None,
    tracer: Tracer | None = None,
) -> FastAPI:
    settings = settings or load_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    engine = make_engine(settings.database_path)
    init_db(engine)
    session_factory = make_session_factory(engine)
    catalog = catalog or Catalog.load(settings.models_file)
    probe = probe or LiveProbe(settings)
    model_factory = model_factory or ProviderChatModelFactory(settings)
    tracer = tracer or build_tracer(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        saver = checkpointer
        connection = None
        if saver is None:
            import aiosqlite
            from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

            connection = await aiosqlite.connect(str(settings.checkpoint_path))
            saver = AsyncSqliteSaver(connection)
            await saver.setup()
        app.state.chat = ChatService(
            session_factory=session_factory,
            catalog=catalog,
            probe=probe,
            engine=ChatEngine(saver),
            tracer=tracer,
            model_factory=model_factory,
            settings=settings,
        )
        try:
            yield
        finally:
            tracer.flush()
            if connection is not None:
                await connection.close()

    app = FastAPI(
        title="Rampart",
        version=__version__,
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = session_factory
    app.state.catalog = catalog
    app.state.probe = probe
    app.state.tracer = tracer

    @app.exception_handler(RampartError)
    async def _domain_error(_request: Request, exc: RampartError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    @app.get("/api/health", response_model=HealthOut, tags=["health"])
    def health() -> HealthOut:
        return HealthOut(
            version=__version__,
            providers={
                "openrouter": probe.openrouter_available(),
                "ollama": probe.ollama_models() is not None,
            },
            tracing=tracer.backend,
        )

    app.include_router(auth_routes.router)
    app.include_router(auth_routes.admin_router)
    app.include_router(catalog_routes.router)
    app.include_router(catalog_routes.admin_router)
    app.include_router(chat_routes.router)
    app.include_router(usage_routes.router)

    dist = (settings.frontend_dist or REPO_ROOT / "frontend" / "dist").resolve()

    @app.get("/{path:path}", include_in_schema=False, response_model=None)
    async def spa(path: str) -> Response:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status_code=404, detail="not found")
        index = dist / "index.html"
        if not index.is_file():
            return JSONResponse(
                status_code=404,
                content={
                    "detail": "frontend build not found: run `npm run build` in frontend/ "
                    "or use the Vite dev server on port 5173"
                },
            )
        if path:
            candidate = (dist / path).resolve()
            if candidate.is_file() and candidate.is_relative_to(dist):
                return FileResponse(candidate)
        return FileResponse(index)

    return app
