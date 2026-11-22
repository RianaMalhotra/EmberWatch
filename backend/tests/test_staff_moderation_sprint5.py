"""Sprint 5 staff API regression tests: deny by default and verify state changes."""
from unittest.mock import patch

import pytest
import app as api
from services.staff_auth import verify_staff
from services.staff_reports import review_report, list_reports


@pytest.fixture
def client():
    api.app.config["TESTING"] = True
    return api.app.test_client()


@pytest.mark.parametrize("path,method", [
    ("/api/staff/reports", "GET"),
    ("/api/staff/reports/1/review", "PATCH"),
])
def test_unauthenticated_staff_routes_denied(client, path, method):
    response = client.open(path, method=method, json={"review_status": "verified"})
    assert response.status_code == 403


def test_spoofed_role_headers_cannot_authorize(client):
    response = client.get("/api/staff/reports", headers={
        "X-Staff": "true", "X-User-Role": "staff", "Authorization": "Bearer forged",
    })
    assert response.status_code == 403


def test_staff_auth_fails_closed_without_config(monkeypatch):
    for name in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "REPORTS_STAFF_USER_IDS"):
        monkeypatch.delenv(name, raising=False)
    assert verify_staff("Bearer abc") is None


def test_staff_auth_requires_verified_allowlisted_user(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "public-anon-key")
    monkeypatch.setenv("REPORTS_STAFF_USER_IDS", "staff-uuid")

    class FakeResponse:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *args): return False

    with patch("services.staff_auth.urlopen") as fetch:
        fetch.return_value = FakeResponse()
        with patch("services.staff_auth.json.load", return_value={"id": "other-uuid"}):
            assert verify_staff("Bearer valid-token") is None
        with patch("services.staff_auth.json.load", return_value={"id": "staff-uuid"}):
            assert verify_staff("Bearer valid-token") == "staff-uuid"


def test_authenticated_staff_can_list_reports(client, monkeypatch):
    monkeypatch.setattr("services.staff_auth.verify_staff", lambda header: "staff-uuid")
    monkeypatch.setattr("services.staff_reports.list_reports", lambda conn, status=None: [{"id": 1, "review_status": "unverified"}])
    monkeypatch.setattr(api, "get_connection", lambda: FakeConnection())
    response = client.get("/api/staff/reports?status=unverified", headers={"Authorization": "Bearer valid"})
    assert response.status_code == 200
    assert response.get_json()["data"][0]["id"] == 1


def test_staff_cannot_set_arbitrary_review_status(client, monkeypatch):
    monkeypatch.setattr("services.staff_auth.verify_staff", lambda header: "staff-uuid")
    response = client.patch("/api/staff/reports/1/review", json={"review_status": "unverified"}, headers={"Authorization": "Bearer valid"})
    assert response.status_code == 400


def test_authenticated_staff_can_review_pending_report(client, monkeypatch):
    monkeypatch.setattr("services.staff_auth.verify_staff", lambda header: "staff-uuid")
    monkeypatch.setattr(api, "get_connection", lambda: FakeConnection())
    monkeypatch.setattr("services.staff_reports.review_report", lambda conn, report_id, status: {"id": report_id, "review_status": status})
    response = client.patch("/api/staff/reports/1/review", json={"review_status": "rejected"}, headers={"Authorization": "Bearer valid"})
    assert response.status_code == 200
    assert response.get_json()["data"]["review_status"] == "rejected"


class FakeConnection:
    def __enter__(self): return self
    def __exit__(self, *args): return False


def test_review_sql_requires_pending_state():
    from services.staff_reports import REVIEW_SQL
    assert "review_status = 'unverified'" in REVIEW_SQL
    assert "returning id, review_status" in REVIEW_SQL.lower()
