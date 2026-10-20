import os

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient
from app.db import Base, database
from app.main import app


@pytest.fixture(autouse=True)
def disable_external_provider(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings(), "openai_api_key", "")


@pytest.fixture
def clients():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def fk_on(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)

    def override():
        with factory() as db:
            yield db

    app.dependency_overrides[database] = override
    with TestClient(app) as teacher, TestClient(app) as student, TestClient(app) as outsider:
        yield teacher, student, outsider, factory
    app.dependency_overrides.clear()
    engine.dispose()


def signup(client, role="lecturer", email="teacher@example.com"):
    r = client.post(
        "/api/v1/auth/register",
        json={"name": role.title(), "email": email, "password": "correct-horse-123", "role": role},
    )
    assert r.status_code == 201, r.text
    return r.json()
