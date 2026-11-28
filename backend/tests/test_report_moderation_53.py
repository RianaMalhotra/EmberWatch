"""Issue #53: staff-only moderation and public report visibility."""
import pytest
from unittest.mock import patch
from contextlib import contextmanager
from urllib.error import HTTPError
from app import app

@pytest.fixture
def client():
    app.config["TESTING"] = True
    return app.test_client()

def test_moderation_requires_staff(client):
    response = client.patch("/api/reports/1/status", json={"status": "confirmed"})
    assert response.status_code == 403

def test_audit_requires_staff(client):
    assert client.get("/api/reports/1/audit").status_code == 403

def test_invalid_status_is_rejected(client, monkeypatch):
    with patch("report_moderation._staff", return_value="staff-uuid"):
        response = client.patch("/api/reports/1/status",
            headers={"Authorization": "Bearer test-secret"}, json={"status": "invented"})
    assert response.status_code == 400

def test_wrong_token_is_rejected(client, monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "public-anon-key")
    monkeypatch.setenv("REPORTS_STAFF_USER_IDS", "allowed-uuid")
    with patch("report_moderation.urlopen", side_effect=HTTPError("https://example.supabase.co/auth/v1/user", 401, "Invalid token", {}, None)) as auth:
        response = client.patch("/api/reports/1/status",
            headers={"Authorization": "Bearer wrong"}, json={"status": "confirmed"})
    assert response.status_code == 403
    auth.assert_called_once()

def test_public_reports_filter_excludes_rejected_and_out():
    from report_moderation import ACTIVE
    assert "unverified" in ACTIVE
    assert "rejected" not in ACTIVE
    assert "out" not in ACTIVE

def test_no_staff_allowlist_denies_access(client, monkeypatch):
    monkeypatch.delenv("REPORTS_STAFF_USER_IDS", raising=False)
    assert client.patch("/api/reports/1/status", headers={"Authorization": "Bearer token"},
                        json={"status": "confirmed"}).status_code == 403

def test_verified_staff_identity(client, monkeypatch):
    import io
    import json
    from report_moderation import _staff
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "public-anon-key")
    monkeypatch.setenv("REPORTS_STAFF_USER_IDS", "allowed-uuid")
    class Response:
        def __enter__(self): return io.BytesIO(json.dumps({"id": "allowed-uuid"}).encode())
        def __exit__(self, *args): return False
    with patch("report_moderation.urlopen", return_value=Response()):
        with app.test_request_context(headers={"Authorization": "Bearer access-token"}):
            assert _staff() == "allowed-uuid"

def test_non_staff_identity_rejected(client, monkeypatch):
    import io
    import json
    from report_moderation import _staff
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "public-anon-key")
    monkeypatch.setenv("REPORTS_STAFF_USER_IDS", "allowed-uuid")
    class Response:
        def __enter__(self): return io.BytesIO(json.dumps({"id": "different-uuid"}).encode())
        def __exit__(self, *args): return False
    with patch("report_moderation.urlopen", return_value=Response()):
        with app.test_request_context(headers={"Authorization": "Bearer access-token"}):
            assert _staff() is None


class FakeConnection:
    def __init__(self, responses=(), error=None):
        self.responses = list(responses)
        self.error = error
        self.queries = []

    def execute(self, sql, params=()):
        self.queries.append((sql, params))
        if self.error:
            raise self.error
        return self.responses.pop(0) if self.responses else FakeResult()

class FakeResult:
    def __init__(self, *, one=None, rows=()):
        self.one = one
        self.rows = rows

    def fetchone(self):
        return self.one

    def fetchall(self):
        return self.rows

@contextmanager
def db_with(conn):
    yield conn

def test_public_endpoint_redacts_unverified_and_rounds_all_coordinates(client):
    rows = [
        (1, 43.123456, -79.987654, "smoke", "private address 123", "2026-11-20", "unverified", "2026-11-20"),
        (2, 45.123456, -80.987654, "smoke", "staff reviewed", "2026-11-20", "confirmed", "2026-11-20"),
    ]
    conn = FakeConnection([FakeResult(rows=rows)])
    with patch("report_moderation.get_connection", return_value=db_with(conn)):
        response = client.get("/api/reports")
    assert response.status_code == 200
    results = response.get_json()["data"]
    assert results[0]["description"] is None
    assert results[0]["latitude"] == 43.12
    assert results[0]["longitude"] == -79.99
    assert results[1]["description"] == "staff reviewed"
    assert results[1]["latitude"] == 45.12
    assert results[1]["longitude"] == -80.99
    sql, parameters = conn.queries[0]
    assert "review_status = any(%s)" in sql
    assert "rejected" not in parameters[0] and "out" not in parameters[0]

def test_public_endpoint_db_failure_is_503(client):
    conn = FakeConnection(error=RuntimeError("db unavailable"))
    with patch("report_moderation.get_connection", return_value=db_with(conn)):
        response = client.get("/api/reports")
    assert response.status_code == 503
    assert response.get_json()["status"] == "unavailable"

def test_moderation_updates_and_writes_audit(client):
    conn = FakeConnection([FakeResult(one=("unverified",))])
    with patch("report_moderation._staff", return_value="staff-uuid"), patch("report_moderation.get_connection", return_value=db_with(conn)):
        response = client.patch("/api/reports/42/status", json={"status": "confirmed"})
    assert response.status_code == 200
    assert response.get_json()["data"]["review_status"] == "confirmed"
    assert len(conn.queries) == 3
    assert "for update" in conn.queries[0][0].lower()
    assert conn.queries[1][1] == ("confirmed", "confirmed", 42)
    assert "ended_at" in conn.queries[1][0].lower()
    assert conn.queries[2][1] == (42, "unverified", "confirmed", "staff-uuid")

def test_moderation_missing_report_is_404(client):
    conn = FakeConnection([FakeResult(one=None)])
    with patch("report_moderation._staff", return_value="staff-uuid"), patch("report_moderation.get_connection", return_value=db_with(conn)):
        response = client.patch("/api/reports/42/status", json={"status": "confirmed"})
    assert response.status_code == 404
    assert len(conn.queries) == 1

def test_moderation_unchanged_status_skips_update_and_audit(client):
    conn = FakeConnection([FakeResult(one=("confirmed",))])
    with patch("report_moderation._staff", return_value="staff-uuid"), patch("report_moderation.get_connection", return_value=db_with(conn)):
        response = client.patch("/api/reports/42/status", json={"status": "confirmed"})
    assert response.status_code == 200
    assert response.get_json()["data"]["unchanged"] is True
    assert len(conn.queries) == 1

def test_authorized_audit_returns_history(client):
    records = [("unverified", "confirmed", "staff-uuid", "2026-11-20")]
    conn = FakeConnection([FakeResult(rows=records)])
    with patch("report_moderation._staff", return_value="staff-uuid"), patch("report_moderation.get_connection", return_value=db_with(conn)):
        response = client.get("/api/reports/42/audit")
    assert response.status_code == 200
    assert response.get_json()["data"][0]["new_status"] == "confirmed"
    assert conn.queries[0][1] == (42,)


def test_staff_reports_requires_authorization(client):
    assert client.get("/api/staff/reports").status_code == 403

def test_staff_reports_returns_all_statuses_and_original_content(client):
    rows = [
        (7, 43.123456, -79.987654, "smoke", "private report text", "2026-11-20", "unverified", "2026-11-20"),
        (8, 44.123456, -78.987654, "flames", "rejected details", "2026-11-20", "rejected", "2026-11-20"),
        (9, 45.123456, -77.987654, "smoke", "resolved details", "2026-11-20", "out", "2026-11-20"),
    ]
    conn = FakeConnection([FakeResult(rows=rows)])
    with patch("report_moderation._staff", return_value="staff-uuid"), patch("report_moderation.get_connection", return_value=db_with(conn)):
        response = client.get("/api/staff/reports")
    assert response.status_code == 200
    data = response.get_json()["data"]
    assert [r["review_status"] for r in data] == ["unverified", "rejected", "out"]
    assert data[0]["description"] == "private report text"
    assert data[0]["latitude"] == 43.123456
    assert data[1]["description"] == "rejected details"
    assert "where review_status" not in conn.queries[0][0].lower()

def test_staff_reports_database_error_is_503(client):
    conn = FakeConnection(error=RuntimeError("db unavailable"))
    with patch("report_moderation._staff", return_value="staff-uuid"), patch("report_moderation.get_connection", return_value=db_with(conn)):
        response = client.get("/api/staff/reports")
    assert response.status_code == 503
    assert response.get_json()["status"] == "unavailable"


@pytest.mark.parametrize("previous,target,expected", [("rejected","out_of_control",409), ("out","being_held",409), ("rejected","verified",200), ("out","confirmed",200), ("verified","confirmed",200)])
def test_status_transitions(client, previous, target, expected):
    conn = FakeConnection([FakeResult(one=(previous,))])
    with patch("report_moderation._staff", return_value="staff-uuid"), patch("report_moderation.get_connection", return_value=db_with(conn)):
        response = client.patch("/api/reports/42/status", json={"status": target})
    assert response.status_code == expected
    assert len(conn.queries) == (3 if expected == 200 else 1)
