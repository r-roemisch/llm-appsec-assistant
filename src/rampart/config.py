"""Application settings, read from the environment and an optional .env file."""

from __future__ import annotations

from pathlib import Path

from pydantic import AliasChoices, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


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
    max_message_chars: int = 32_000
    frontend_dist: Path | None = None
    ollama_probe_ttl_seconds: float = 30.0

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
    def openrouter_configured(self) -> bool:
        return self.openrouter_api_key is not None

    @property
    def langfuse_configured(self) -> bool:
        return self.langfuse_public_key is not None and self.langfuse_secret_key is not None


def load_settings(**overrides: object) -> Settings:
    """Build settings from the environment, with keyword overrides for tests and the CLI."""
    return Settings(**overrides)  # type: ignore[arg-type]
