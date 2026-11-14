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
    monkeypatch.setenv("REPORTS_STAFF_TOKEN", "test-secret")
    response = client.patch("/api/reports/1/status",
        headers={"Authorization": "Bearer test-secret"}, json={"status": "invented"})
    assert response.status_code == 400

def test_wrong_token_is_rejected(client, monkeypatch):
    monkeypatch.setenv("REPORTS_STAFF_TOKEN", "test-secret")
    response = client.patch("/api/reports/1/status",
        headers={"Authorization": "Bearer wrong"}, json={"status": "confirmed"})
    assert response.status_code == 403

def test_public_reports_filter_excludes_rejected_and_out():
    from report_moderation import ACTIVE
    assert "unverified" in ACTIVE
    assert "rejected" not in ACTIVE
    assert "out" not in ACTIVE
