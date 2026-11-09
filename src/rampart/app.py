"""The FastAPI application: services wired together, the API routers, and the SPA files."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from langgraph.checkpoint.base import BaseCheckpointSaver

from rampart import __version__
from rampart.admin import router as admin_routes
from rampart.auth import router as auth_routes
from rampart.catalog import router as catalog_routes
from rampart.catalog.catalog import Catalog
from rampart.catalog.providers import LiveProbe, ProviderProbe
from rampart.chat import router as chat_routes
from rampart.chat.engine import ChatEngine
from rampart.chat.llm import ChatModelFactory, ProviderChatModelFactory
from rampart.chat.service import ChatService
from rampart.config import REPO_ROOT, Settings, load_settings
from rampart.db import init_db, make_engine, make_session_factory
from rampart.errors import RampartError
from rampart.eval import router as eval_routes
from rampart.eval.service import EvalService, SubprocessLauncher
from rampart.feedback import router as feedback_routes
from rampart.gateway.gateway import Gateway
from rampart.knowledge import router as knowledge_routes
from rampart.knowledge.embeddings import EmbedderFactory, ProviderEmbedderFactory
from rampart.knowledge.service import KnowledgeService
from rampart.knowledge.vectors import ChromaVectorStore, VectorStore
from rampart.plugins import router as plugin_routes
from rampart.plugins.connection import ClientFactory, stdio_client_factory
from rampart.plugins.service import PluginService
from rampart.plugins.tools import PluginToolSource
from rampart.profile import router as profile_routes
from rampart.schemas import HealthOut
from rampart.targets import router as target_routes
from rampart.tools import router as tool_routes
from rampart.tools.builtin import build_registry
from rampart.tools.osv import OsvClient
from rampart.tracing import Tracer, build_tracer
from rampart.usage import router as usage_routes


def create_app(
    settings: Settings | None = None,
    *,
    catalog: Catalog | None = None,
    probe: ProviderProbe | None = None,
    model_factory: ChatModelFactory | None = None,
    checkpointer: BaseCheckpointSaver | None = None,
    tracer: Tracer | None = None,
    embedder_factory: EmbedderFactory | None = None,
    vector_store_factory: Callable[[], VectorStore] | None = None,
    plugin_client_factory: ClientFactory | None = None,
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
    knowledge = KnowledgeService(
        session_factory=session_factory,
        catalog=catalog,
        probe=probe,
        settings=settings,
        embedder_factory=embedder_factory or ProviderEmbedderFactory(settings),
        vector_store_factory=vector_store_factory
        or (lambda: ChromaVectorStore(settings.chroma_dir)),
    )
    osv = OsvClient(
        session_factory,
        ttl_hours=settings.osv_cache_ttl_hours,
        timeout=settings.osv_timeout_seconds,
    )
    registry = build_registry(settings, osv)
    plugins = PluginService(
        session_factory,
        settings,
        plugin_client_factory or stdio_client_factory(settings),
        builtin_names=frozenset(registry.names()),
    )
    registry.add_source(PluginToolSource(plugins))
    gateway = Gateway(session_factory, registry, settings)
    evaluation = EvalService(
        session_factory=session_factory, settings=settings, catalog=catalog, probe=probe
    )

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
            knowledge=knowledge,
            registry=registry,
            gateway=gateway,
        )
        try:
            yield
        finally:
            tracer.flush()
            close = getattr(model_factory, "aclose", None)
            if close is not None:
                await close()
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
    app.state.knowledge = knowledge
    app.state.osv = osv
    app.state.registry = registry
    app.state.gateway = gateway
    app.state.plugins = plugins
    app.state.eval = evaluation
    app.state.eval_launcher = SubprocessLauncher(settings, session_factory)

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
    app.include_router(knowledge_routes.router)
    app.include_router(knowledge_routes.help_router)
    app.include_router(profile_routes.router)
    app.include_router(admin_routes.router)
    app.include_router(tool_routes.router)
    app.include_router(target_routes.router)
    app.include_router(plugin_routes.router)
    app.include_router(feedback_routes.router)
    app.include_router(feedback_routes.admin_router)
    app.include_router(eval_routes.router)

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
