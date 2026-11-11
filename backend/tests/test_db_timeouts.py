"""#49: the database layer must fail fast instead of hanging the API."""
import pytest
import psycopg

import app as api
import db


@pytest.fixture
def captured_connect(monkeypatch):
    calls = []
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@localhost/none")
    monkeypatch.setattr(db.psycopg, "connect", lambda url, **kw: calls.append(kw) or object())
    return calls


def test_connection_always_has_a_connect_timeout(captured_connect, monkeypatch):
    monkeypatch.delenv("DB_STATEMENT_TIMEOUT_MS", raising=False)
    db.get_connection()
    assert captured_connect[0]["connect_timeout"] == 5
    assert "options" not in captured_connect[0]  # opt-in only


def test_statement_timeout_is_applied_when_configured(captured_connect, monkeypatch):
    monkeypatch.setenv("DB_STATEMENT_TIMEOUT_MS", "8000")
    db.get_connection()
    assert captured_connect[0]["options"] == "-c statement_timeout=8000"


@pytest.mark.parametrize("raw", ["", "abc", "0", "-5", "1.5"])
def test_bad_statement_timeout_is_ignored(captured_connect, monkeypatch, raw):
    monkeypatch.setenv("DB_STATEMENT_TIMEOUT_MS", raw)
    db.get_connection()
    assert "options" not in captured_connect[0]


class QueryTimeout(psycopg.errors.QueryCanceled):
    pass


def test_cancelled_query_is_reported_as_unavailable_not_a_hang(monkeypatch):
    """A query cancelled by statement_timeout looks like any other data-source
    failure: 503, no data, no database details."""
    class Conn:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def execute(self, *a, **k):
            raise QueryTimeout("canceling statement due to statement timeout")

        def cursor(self):
            raise QueryTimeout("canceling statement due to statement timeout")

    monkeypatch.setattr(api, "get_connection", lambda: Conn())
    client = api.app.test_client()

    risk = client.get("/api/risk-areas")
    detections = client.get("/api/detections")

    assert risk.status_code == 503 and "data" not in risk.get_json()
    assert detections.status_code == 503 and "detections" not in detections.get_json()
    assert "statement timeout" not in risk.get_data(as_text=True)
