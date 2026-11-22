"""Unauthenticated staff moderation must never be publicly accessible."""
import pytest
from app import app

@pytest.mark.parametrize("path", [
    "/api/staff/reports", "/api/staff/reports/1",
    "/api/staff/moderation", "/api/admin/reports",
])
def test_staff_paths_not_public_without_token(path):
    response = app.test_client().get(path)
    assert response.status_code in (401, 403, 404)
