"""SQLite engine in WAL mode, the declarative base, and small time helpers."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine, event, insert, inspect, select
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    """Naive UTC timestamp; SQLite stores no zone, so every stored time is UTC by convention."""
    return datetime.now(UTC).replace(tzinfo=None)


def to_iso(value: datetime) -> str:
    """Serialise a stored UTC timestamp as ISO 8601 with a Z suffix and no microseconds."""
    if value.tzinfo is not None:
        value = value.astimezone(UTC).replace(tzinfo=None)
    return value.replace(microsecond=0).isoformat() + "Z"


def make_engine(path: Path) -> Engine:
    path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{path}",
        connect_args={"check_same_thread": False, "timeout": 5},
    )

    @event.listens_for(engine, "connect")
    def _configure(dbapi_connection, _record) -> None:  # type: ignore[no-untyped-def]
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

    return engine


def init_db(engine: Engine) -> None:
    from rampart import models  # noqa: F401  (registers the tables)

    Base.metadata.create_all(engine)
    _add_missing_columns(engine)
    _merge_legacy_settings(engine)


def _add_missing_columns(engine: Engine) -> None:
    """Add columns that newer milestones declare to tables an older database already has.

    ``create_all`` creates missing tables but never alters existing ones. New columns are
    always nullable or carry a server default, so ``ALTER TABLE ... ADD COLUMN`` is enough.
    """
    inspector = inspect(engine)
    statements: list[str] = []
    for table in Base.metadata.sorted_tables:
        if not inspector.has_table(table.name):
            continue
        existing = {column["name"] for column in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in existing:
                continue
            ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" '
            ddl += column.type.compile(dialect=engine.dialect)
            default = column.server_default
            if default is not None and hasattr(default, "arg"):
                arg = default.arg  # type: ignore[attr-defined]
                ddl += f" DEFAULT {getattr(arg, 'text', arg)}"
            statements.append(ddl)
    if statements:
        with engine.begin() as connection:
            for ddl in statements:
                connection.exec_driver_sql(ddl)


def _slot_override(row: Any) -> tuple[str, dict[str, Any]]:
    slot, model_id, temperature, max_tokens = row
    return f"slot:{slot}", {
        "model_id": model_id,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }


def _model_switch(row: Any) -> tuple[str, dict[str, Any]]:
    model_id, enabled = row
    return f"model:{model_id}", {"enabled": bool(enabled)}


_LEGACY_SETTINGS = (
    (
        "slot_settings",
        "SELECT slot, model_id, temperature, max_tokens FROM slot_settings",
        _slot_override,
    ),
    ("model_settings", "SELECT model_id, enabled FROM model_settings", _model_switch),
)


def _merge_legacy_settings(engine: Engine) -> None:
    """Databases made before the M7 cleanup kept Slot overrides and Model switches in tables of
    their own. Their rows become ``app_settings`` rows (``slot:<slot>``, ``model:<model_id>``)
    and the tables are dropped; a key that already exists is left alone."""
    from rampart.models import AppSetting

    inspector = inspect(engine)
    with engine.begin() as connection:
        for table, query, convert in _LEGACY_SETTINGS:
            if not inspector.has_table(table):
                continue
            for row in connection.exec_driver_sql(query).all():
                key, value = convert(row)
                present = connection.execute(select(AppSetting.key).where(AppSetting.key == key))
                if present.first() is None:
                    connection.execute(
                        insert(AppSetting).values(key=key, value=value, updated_at=utcnow())
                    )
            connection.exec_driver_sql(f'DROP TABLE "{table}"')


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)


@contextmanager
def session_scope(factory: sessionmaker[Session]) -> Iterator[Session]:
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
