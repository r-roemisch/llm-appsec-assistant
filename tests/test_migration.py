import sqlite3

from sqlalchemy import inspect

from conftest import REPO
from helpers import StaticProbe
from rampart.catalog.catalog import Catalog
from rampart.catalog.service import CatalogService
from rampart.db import init_db, make_engine, make_session_factory, session_scope
from rampart.models import AppSetting


def test_an_m1_database_gains_the_m2_columns(tmp_path):
    path = tmp_path / "old.sqlite3"
    with sqlite3.connect(path) as connection:  # the M1 shape of the two changed tables
        connection.executescript(
            """
            CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(64) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL, role VARCHAR(16) NOT NULL,
                created_at DATETIME NOT NULL);
            CREATE TABLE conversations (id VARCHAR(36) PRIMARY KEY, user_id INTEGER NOT NULL,
                title VARCHAR(200) NOT NULL, model_id VARCHAR(200) NOT NULL,
                created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL);
            CREATE TABLE messages (id VARCHAR(36) PRIMARY KEY, conversation_id VARCHAR(36) NOT NULL,
                role VARCHAR(16) NOT NULL, content TEXT NOT NULL, created_at DATETIME NOT NULL,
                model_id VARCHAR(200), provider VARCHAR(32), input_tokens INTEGER,
                output_tokens INTEGER, cost_usd FLOAT, latency_ms INTEGER, trace_id VARCHAR(64),
                status VARCHAR(16) NOT NULL, error TEXT);
            INSERT INTO users VALUES (1, 'alice', 'x', 'user', '2026-11-06 10:00:00');
            INSERT INTO conversations VALUES ('c1', 1, 'Old', 'm', '2026-11-06 10:00:00',
                '2026-11-06 10:00:00');
            """
        )
    engine = make_engine(path)
    init_db(engine)
    inspector = inspect(engine)
    assert "help_mode" in {c["name"] for c in inspector.get_columns("conversations")}
    assert {"citations", "retrieval_mode"} <= {c["name"] for c in inspector.get_columns("messages")}
    assert {"sources", "passages", "project_profiles", "model_calls"} <= set(inspector.get_table_names())
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT help_mode FROM conversations").scalar() == 0
    init_db(engine)  # running again changes nothing


def test_slot_and_model_overrides_of_an_older_database_move_into_app_settings(tmp_path):
    path = tmp_path / "old.sqlite3"
    with sqlite3.connect(path) as connection:  # the two override tables of M1 to M7
        connection.executescript(
            """
            CREATE TABLE slot_settings (slot VARCHAR(16) PRIMARY KEY, model_id VARCHAR(200),
                temperature FLOAT, max_tokens INTEGER, updated_at DATETIME NOT NULL);
            CREATE TABLE model_settings (model_id VARCHAR(200) PRIMARY KEY,
                enabled BOOLEAN NOT NULL, updated_at DATETIME NOT NULL);
            INSERT INTO slot_settings VALUES ('chat', 'anthropic/claude-haiku-5.5', 0.2, 1000,
                '2026-11-06 10:00:00');
            INSERT INTO model_settings VALUES ('anthropic/claude-opus-5.5', 0, '2026-11-06 10:00:00');
            """
        )
    engine = make_engine(path)
    init_db(engine)
    tables = set(inspect(engine).get_table_names())
    assert "app_settings" in tables and not {"slot_settings", "model_settings"} & tables
    catalog = Catalog.load(REPO / "models.yaml")
    with session_scope(make_session_factory(engine)) as db:
        assert AppSetting.read(db, "slot:chat") == {"model_id": "anthropic/claude-haiku-5.5", "temperature": 0.2, "max_tokens": 1000}
        service = CatalogService(db, catalog, StaticProbe())
        chat = service.slot_config("chat")
        assert (chat.source, chat.model.id, chat.temperature, chat.max_tokens) == ("override", "anthropic/claude-haiku-5.5", 0.2, 1000)
        assert service.is_enabled("anthropic/claude-opus-5.5") is False
        assert service.is_enabled("openai/gpt-6-luna") is True
    init_db(engine)  # running again changes nothing
    with session_scope(make_session_factory(engine)) as db:
        assert AppSetting.read(db, "model:anthropic/claude-opus-5.5") == {"enabled": False}
