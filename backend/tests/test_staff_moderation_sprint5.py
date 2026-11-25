"""Regression checks for the canonical Sprint 5 moderation API (PR #104).

PR #112 originally introduced duplicate staff endpoints.  After #104 merged,
those endpoints shadowed neither the registered blueprint routes nor its
authentication guard.  Keep these tests against the route Flask actually uses.
"""
from contextlib import contextmanager
from unittest.mock import patch

import pytest

import app as api
from report_moderation import _staff, ALLOWED_TRANSITIONS, ACTIVE


@pytest.fixture
def client():
    api.app.config["TESTING"] = True
    return api.app.test_client()


class FakeResult:
    def __init__(self, rows=(), one=None):
        self.rows = rows
        self.one = one

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.one


class FakeConnection:
    def __init__(self, results=()):
        self.results = list(results)
        self.queries = []

    def execute(self, sql, params=()):
        self.queries.append((sql, params))
        return self.results.pop(0) if self.results else FakeResult()


@contextmanager
def db_with(conn):
    yield conn


def test_unauthenticated_staff_routes_denied(client):
    assert client.get("/api/staff/reports").status_code == 403
    assert client.patch("/api/reports/1/status", json={"status": "verified"}).status_code == 403


def test_spoofed_role_headers_cannot_authorize(client):
    response = client.get("/api/staff/reports", headers={
        "X-Staff": "true", "X-User-Role": "staff", "Authorization": "Bearer forged",
    })
    assert response.status_code == 403


def test_staff_auth_fails_closed_without_config(client, monkeypatch):
    for name in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "REPORTS_STAFF_USER_IDS"):
        monkeypatch.delenv(name, raising=False)
    assert client.get("/api/staff/reports", headers={"Authorization": "Bearer abc"}).status_code == 403


def test_staff_auth_requires_verified_allowlisted_user(client, monkeypatch):
    import io
    import json

    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "public-anon-key")
    monkeypatch.setenv("REPORTS_STAFF_USER_IDS", "staff-uuid")

    class FakeResponse:
        def __enter__(self):
            return io.BytesIO(json.dumps(self.user).encode("utf-8"))

        def __exit__(self, *args):
            return False

    with patch("report_moderation.urlopen") as fetch:
        denied = FakeResponse()
        denied.user = {"id": "other-uuid"}
        fetch.return_value = denied
        with api.app.test_request_context(headers={"Authorization": "Bearer valid-token"}):
            assert _staff() is None

        allowed = FakeResponse()
        allowed.user = {"id": "staff-uuid"}
        fetch.return_value = allowed
        with api.app.test_request_context(headers={"Authorization": "Bearer valid-token"}):
            assert _staff() == "staff-uuid"


def test_authenticated_staff_can_list_all_report_statuses(client):
    rows = [
        (1, 43.123456, -79.987654, "smoke", "private report text",
         "2026-11-20", "unverified", "2026-11-20"),
        (2, 44.123456, -78.987654, "smoke", "rejected report text",
         "2026-11-20", "rejected", "2026-11-20"),
    ]
    conn = FakeConnection([FakeResult(rows=rows)])
    with patch("report_moderation._staff", return_value="staff-uuid"), \
         patch("report_moderation.get_connection", return_value=db_with(conn)):
        response = client.get("/api/staff/reports", headers={"Authorization": "Bearer valid"})
    assert response.status_code == 200
    assert [row["review_status"] for row in response.get_json()["data"]] == ["unverified", "rejected"]
    assert response.get_json()["data"][0]["description"] == "private report text"
    assert response.get_json()["data"][0]["latitude"] == 43.123456
    assert "where review_status" not in conn.queries[0][0].lower()


@pytest.mark.parametrize("status", ["invalid", "unverified"])
def test_staff_cannot_set_invalid_status(client, status):
    with patch("report_moderation._staff", return_value="staff-uuid"):
        response = client.patch("/api/reports/1/status", json={"status": status})
    assert response.status_code == 400


def test_authenticated_staff_can_review_pending_report_with_audit(client):
    conn = FakeConnection([FakeResult(one=("unverified",))])
    with patch("report_moderation._staff", return_value="staff-uuid"), \
         patch("report_moderation.get_connection", return_value=db_with(conn)):
        response = client.patch("/api/reports/1/status", json={"status": "rejected"})
    assert response.status_code == 200
    assert response.get_json()["data"]["review_status"] == "rejected"
    assert len(conn.queries) == 3
    assert "for update" in conn.queries[0][0].lower()
    assert "insert into public.fire_report_audit" in conn.queries[2][0].lower()
    assert conn.queries[2][1] == (1, "unverified", "rejected", "staff-uuid")


def test_disallowed_status_transition_is_conflict_and_not_audited(client):
    assert "out_of_control" not in ALLOWED_TRANSITIONS["rejected"]
    conn = FakeConnection([FakeResult(one=("rejected",))])
    with patch("report_moderation._staff", return_value="staff-uuid"), \
         patch("report_moderation.get_connection", return_value=db_with(conn)):
        response = client.patch("/api/reports/1/status", json={"status": "out_of_control"})
    assert response.status_code == 409
    assert len(conn.queries) == 1


def test_public_active_statuses_exclude_rejected_and_out():
    assert "rejected" not in ACTIVE
    assert "out" not in ACTIVE
    assert "unverified" in ACTIVE
