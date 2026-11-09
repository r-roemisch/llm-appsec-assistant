"""Application settings, read from the environment and an optional .env file."""

from __future__ import annotations

from pathlib import Path

from pydantic import AliasChoices, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Everything configurable from outside the code.

    Provider and tracing keys keep their conventional unprefixed names so that the
    vendor SDKs and CLIs read the same values; application settings use ``RAMPART_``.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="RAMPART_",
        extra="ignore",
    )

    data_dir: Path = Path("data")
    models_file: Path = Path("models.yaml")
    host: str = "127.0.0.1"
    port: int = 8000
    app_url: str = "http://127.0.0.1:8000"
    session_ttl_hours: int = 24 * 7
    cookie_secure: bool = False
    # Login throttling (M7): failed sign-ins per username and per client address in a window.
    login_window_minutes: int = 15
    login_max_failures_per_user: int = 5
    login_max_failures_per_client: int = 30
    # Read the client address from X-Forwarded-For. Only behind a proxy that sets it; otherwise a
    # client could pick its own address and escape the per-client limit.
    trust_proxy_headers: bool = False
    max_message_chars: int = 32_000
    frontend_dist: Path | None = None
    ollama_probe_ttl_seconds: float = 30.0
    # Ollama's default context (4096 tokens) is smaller than a retrieval prompt, and Ollama cuts
    # the start of a prompt that does not fit, which is where the system prompt sits.
    ollama_num_ctx: int = 16384
    # Thinking makes local models on a CPU many times slower. Routing, grading and query
    # rewriting never think; this switch lets local answers think.
    ollama_thinking: bool = False

    # Knowledge Base (M2)
    docs_dir: Path = REPO_ROOT / "docs"
    fixtures_dir: Path = REPO_ROOT / "fixtures"
    max_upload_bytes: int = 5 * 1024 * 1024
    max_uploads_per_user: int = 50
    max_upload_pages: int = 300
    retrieval_k: int = 6
    max_context_passages: int = 6
    min_relevant_passages: int = 1
    max_rewrites: int = 2
    max_model_calls_per_turn: int = 8
    # Short-term memory: past this many (estimated) tokens of model-facing history, older turns
    # are summarised; the last few user turns always stay word for word.
    history_summary_tokens: int = 6000
    history_keep_turns: int = 3
    retrieval_budget_seconds: float = 60.0
    fetch_timeout_seconds: float = 60.0

    # Controls (M3)
    max_tool_calls_per_turn: int = 6
    conversation_token_budget: int = 200_000  # default; admins override it in the database
    approval_ttl_minutes: int = 15
    admin_approval_ttl_hours: int = 24
    osv_cache_ttl_hours: int = 6
    osv_timeout_seconds: float = 20.0

    # Plugins (M5): the catalog file is the only place a Plugin's command is defined
    plugins_dir: Path = REPO_ROOT / "plugins"
    plugins_catalog: Path | None = None  # default: plugins_dir / "catalog.yaml"
    plugin_timeout_seconds: float = 20.0

    # Evaluation (M6). The datasets are read only by `rampart eval`, never at runtime.
    eval_dir: Path = REPO_ROOT / "eval"
    eval_reports_dir: Path = REPO_ROOT / "docs" / "reports" / "eval"
    eval_concurrency: int = 4  # judge calls in flight
    eval_threshold: float = 0.7  # a DeepEval score at or above this passes

    openrouter_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("OPENROUTER_API_KEY", "RAMPART_OPENROUTER_API_KEY"),
    )
    ollama_host: str = Field(
        default="http://127.0.0.1:11434",
        validation_alias=AliasChoices("OLLAMA_HOST", "RAMPART_OLLAMA_HOST"),
    )
    langfuse_public_key: str | None = Field(
        default=None, validation_alias=AliasChoices("LANGFUSE_PUBLIC_KEY")
    )
    langfuse_secret_key: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("LANGFUSE_SECRET_KEY")
    )
    langfuse_host: str = Field(
        default="https://cloud.langfuse.com", validation_alias=AliasChoices("LANGFUSE_HOST")
    )

    @field_validator("ollama_host")
    @classmethod
    def _normalise_ollama_host(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if not value.startswith(("http://", "https://")):
            value = f"http://{value}"
        return value

    @field_validator("openrouter_api_key", "langfuse_secret_key", mode="before")
    @classmethod
    def _blank_secret_is_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("langfuse_public_key", mode="before")
    @classmethod
    def _blank_key_is_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @property
    def database_path(self) -> Path:
        return self.data_dir / "rampart.sqlite3"

    @property
    def checkpoint_path(self) -> Path:
        return self.data_dir / "checkpoints.sqlite3"

    @property
    def traces_dir(self) -> Path:
        return self.data_dir / "traces"

    @property
    def chroma_dir(self) -> Path:
        return self.data_dir / "chroma"

    @property
    def plugins_catalog_path(self) -> Path:
        return self.plugins_catalog or self.plugins_dir / "catalog.yaml"

    @property
    def eval_work_dir(self) -> Path:
        """Snapshots and logs of evaluation runs; deleted or replaced run by run."""
        return self.data_dir / "eval"

    @property
    def plugin_work_dir(self) -> Path:
        """Each Plugin process runs in its own folder here, with its stderr log."""
        return self.data_dir / "plugins"

    @property
    def openrouter_configured(self) -> bool:
        return self.openrouter_api_key is not None

    @property
    def langfuse_configured(self) -> bool:
        return self.langfuse_public_key is not None and self.langfuse_secret_key is not None


def load_settings(**overrides: object) -> Settings:
    """Build settings from the environment, with keyword overrides for tests and the CLI."""
    return Settings(**overrides)  # type: ignore[arg-type]
