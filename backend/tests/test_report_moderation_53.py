"""Issue #53: staff-only moderation and public report visibility."""
import pytest
from unittest.mock import patch
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
    response = client.patch("/api/reports/1/status",
        headers={"Authorization": "Bearer wrong"}, json={"status": "confirmed"})
    assert response.status_code == 403

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
