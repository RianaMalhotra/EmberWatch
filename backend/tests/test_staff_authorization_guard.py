"""Security regressions for public reports and staff-only moderation boundaries.

These tests inspect the actual Flask route map so a newly introduced staff route
cannot silently bypass checks just because an older guessed URL returns 404.
A 404 on a nonexistent route is NOT evidence of implemented RBAC. Once staff
routes are merged, add authenticated staff/user role tests using real JWT
verification and database fixtures.
"""
import pytest
from app import app

STAFF_PREFIXES = ("/api/staff", "/api/admin", "/api/moderation")
REPORT_WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")


def _staff_rules():
    return [
        rule for rule in app.url_map.iter_rules()
        if rule.rule.startswith(STAFF_PREFIXES)
    ]


def _path(rule):
    """Supply harmless values for any Flask path variables."""
    path = rule.rule
    for part in rule.rule.split("/"):
        if part.startswith("<") and part.endswith(">"):
            path = path.replace(part, "1")
    return path


@pytest.mark.parametrize("method", ["GET", "POST", "PUT", "PATCH", "DELETE"])
@pytest.mark.parametrize("path", [
    "/api/staff/reports", "/api/staff/reports/1",
    "/api/staff/moderation", "/api/admin/reports",
])
def test_common_staff_paths_not_public_without_credentials(path, method):
    response = app.test_client().open(path, method=method, json={})
    assert response.status_code in (401, 403, 404, 405), (
        f"Unauthenticated {method} {path} exposed HTTP {response.status_code}"
    )


def test_discovered_staff_routes_require_credentials():
    client = app.test_client()
    for rule in _staff_rules():
        for method in sorted(rule.methods - {"HEAD", "OPTIONS"}):
            response = client.open(_path(rule), method=method, json={})
            assert response.status_code in (401, 403, 404, 405), (
                f"Staff route {method} {rule.rule} exposed HTTP {response.status_code}"
            )


@pytest.mark.parametrize("method", ["PUT", "PATCH", "DELETE"])
@pytest.mark.parametrize("path", ["/api/reports", "/api/reports/1"])
def test_public_cannot_modify_or_delete_reports(method, path):
    response = app.test_client().open(path, method=method, json={
        "review_status": "verified", "status": "confirmed",
    })
    assert response.status_code in (401, 403, 404, 405)


@pytest.mark.parametrize("method", ["GET", "POST", "PUT", "PATCH", "DELETE"])
def test_internal_metrics_never_exposed_without_secret(method, monkeypatch):
    monkeypatch.delenv("METRICS_TOKEN", raising=False)
    response = app.test_client().open("/api/internal/metrics", method=method)
    assert response.status_code in (401, 403, 404, 405)


def test_untrusted_role_headers_do_not_grant_staff_access():
    headers = {
        "X-User-Role": "staff",
        "X-Staff": "true",
        "X-Forwarded-User": "admin",
        "Authorization": "Bearer forged-token",
    }
    client = app.test_client()
    for rule in _staff_rules():
        for method in sorted(rule.methods - {"HEAD", "OPTIONS"}):
            response = client.open(_path(rule), method=method, headers=headers, json={})
            assert response.status_code in (401, 403, 404, 405), (
                f"Untrusted headers granted {method} {rule.rule}"
            )
