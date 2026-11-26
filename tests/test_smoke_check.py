"""Tests for scripts/smoke_check.py (issue #61). No network: requests are faked."""
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import smoke_check as sc  # noqa: E402

BASE = "https://api.example.com"
SITE = "https://site.example.com"


def ok(payload, headers=None, ms=12):
    return sc.Response(200, headers or {}, json.dumps(payload), ms)


def healthy_routes():
    return {
        "/api/health": ok({"status": "ok"}),
        "/api/health/db": ok({"status": "ok"}),
        "/api/detections?limit=5": ok({"status": "success", "detections": [{"id": 1}, {"id": 2}]}),
        "/api/risk-areas": ok({"status": "success", "data": [{"name": "a"}, {"name": "b"}]}),
        "/api/health/freshness": ok({"status": "ok"}),
    }


def make_fetch(routes, calls=None):
    def fetch(url, headers):
        path = url[len(BASE):]
        if calls is not None:
            calls.append((path, headers))
        origin = (headers or {}).get("Origin")
        if origin and path == "/api/health" and "cors" in routes:
            return routes["cors"](origin)
        return routes[path]
    return fetch


def outcomes(results):
    return [item.outcome for item in results]


def test_everything_healthy_passes():
    results = sc.run_checks(BASE, make_fetch(healthy_routes()))
    assert outcomes(results) == [sc.PASS] * 5


def test_database_down_fails_and_exit_code_is_1(capsys):
    routes = healthy_routes()
    routes["/api/health/db"] = sc.Response(503, {}, '{"status":"unavailable"}', 5)
    assert sc.main([BASE], fetch=make_fetch(routes)) == 1
    out = capsys.readouterr().out
    assert "FAIL" in out and "HTTP 503" in out


def test_empty_risk_areas_fail():
    routes = healthy_routes()
    routes["/api/risk-areas"] = ok({"status": "success", "data": []})
    results = sc.run_checks(BASE, make_fetch(routes))
    assert results[3].outcome == sc.FAIL
    assert "0 areas" in results[3].detail


def test_min_areas_is_enforced():
    results = sc.run_checks(BASE, make_fetch(healthy_routes()), min_areas=13)
    assert results[3].outcome == sc.FAIL
    assert "expected at least 13" in results[3].detail


def test_no_detections_is_a_warning_not_a_failure(capsys):
    routes = healthy_routes()
    routes["/api/detections?limit=5"] = ok({"status": "success", "detections": []})
    results = sc.run_checks(BASE, make_fetch(routes))
    assert results[2].outcome == sc.WARN
    assert sc.main([BASE], fetch=make_fetch(routes)) == 0


def test_stale_freshness_is_only_a_warning():
    routes = healthy_routes()
    routes["/api/health/freshness"] = sc.Response(503, {}, "{}", 3)
    results = sc.run_checks(BASE, make_fetch(routes))
    assert results[4].outcome == sc.WARN
    assert sc.FAIL not in outcomes(results)


@pytest.mark.parametrize("body", ["<html>Not found</html>", "[1, 2]", ""])
def test_non_json_object_bodies_fail(body):
    routes = healthy_routes()
    routes["/api/health"] = sc.Response(200, {}, body, 4)
    results = sc.run_checks(BASE, make_fetch(routes), wake_attempts=1)
    assert results[0].outcome == sc.FAIL


def test_wrong_status_field_fails():
    routes = healthy_routes()
    routes["/api/health/db"] = ok({"status": "degraded"})
    assert sc.run_checks(BASE, make_fetch(routes))[1].outcome == sc.FAIL


def test_cold_start_is_retried_until_the_service_wakes():
    answers = [sc.Response(503, {}, "", 1), sc.Response(0, {}, "TimeoutError: slow", 1), ok({"status": "ok"})]
    sleeps = []

    def fetch(url, headers):
        return answers.pop(0)

    response = sc.fetch_with_wake_up(fetch, BASE + "/api/health", attempts=4, wait_seconds=15, sleep=sleeps.append)
    assert response.status == 200
    assert sleeps == [15, 15]


def test_cold_start_gives_up_after_the_attempts():
    sleeps = []
    response = sc.fetch_with_wake_up(lambda url, headers: sc.Response(503, {}, "", 1),
                                     BASE + "/api/health", attempts=3, wait_seconds=1, sleep=sleeps.append)
    assert response.status == 503
    assert len(sleeps) == 2


def test_a_real_error_is_not_retried():
    calls = []

    def fetch(url, headers):
        calls.append(url)
        return sc.Response(404, {}, "", 1)

    sc.fetch_with_wake_up(fetch, BASE + "/api/health", attempts=4, wait_seconds=1, sleep=lambda s: None)
    assert len(calls) == 1


def test_unreachable_backend_reports_the_network_error():
    routes = {path: sc.Response(0, {}, "URLError: connection refused", 1) for path in healthy_routes()}
    results = sc.run_checks(BASE, make_fetch(routes), wake_attempts=1)
    assert results[0].outcome == sc.FAIL
    assert "connection refused" in results[0].detail


def test_only_get_requests_to_expected_paths_are_made():
    calls = []
    routes = healthy_routes()
    routes["cors"] = lambda origin: ok({"status": "ok"}, {"access-control-allow-origin": origin} if origin == SITE else {})
    sc.run_checks(BASE, make_fetch(routes, calls), frontend_origin=SITE)
    paths = {path for path, _ in calls}
    assert paths == {"/api/health", "/api/health/db", "/api/detections?limit=5", "/api/risk-areas", "/api/health/freshness"}


def cors_routes(allowed_header, denied_header):
    routes = healthy_routes()

    def cors(origin):
        header = allowed_header if origin == SITE else denied_header
        return ok({"status": "ok"}, {"access-control-allow-origin": header} if header else {})
    routes["cors"] = cors
    return routes


def test_cors_allows_the_frontend_and_blocks_strangers():
    results = sc.run_checks(BASE, make_fetch(cors_routes(SITE, None)), frontend_origin=SITE)
    assert results[-2].name == "CORS allowed" and results[-2].outcome == sc.PASS
    assert results[-1].name == "CORS denied" and results[-1].outcome == sc.PASS


def test_cors_fails_when_the_frontend_origin_is_missing():
    results = sc.run_checks(BASE, make_fetch(cors_routes(None, None)), frontend_origin=SITE)
    assert results[-2].outcome == sc.FAIL
    assert "CORS_ORIGINS" in results[-2].detail


def test_cors_fails_when_every_origin_is_allowed():
    results = sc.run_checks(BASE, make_fetch(cors_routes("*", "*")), frontend_origin=SITE)
    assert results[-2].outcome == sc.FAIL      # "*" is not the frontend's origin
    assert results[-1].outcome == sc.FAIL      # strangers must not be allowed


def test_cors_checks_are_skipped_without_a_frontend_origin():
    results = sc.run_checks(BASE, make_fetch(healthy_routes()))
    assert not any(item.name.startswith("CORS") for item in results)


@pytest.mark.parametrize("raw,expected", [
    ("https://api.example.com", "https://api.example.com"),
    ("https://api.example.com/", "https://api.example.com"),
    ("  http://127.0.0.1:5000  ", "http://127.0.0.1:5000"),
])
def test_normalize_base_url_accepts_origins(raw, expected):
    assert sc.normalize_base_url(raw) == expected


@pytest.mark.parametrize("raw", [
    "", "api.example.com", "ftp://api.example.com", "file:///etc/passwd",
    "https://api.example.com/api/health", "https://api.example.com?x=1",
    "https://user:secret@api.example.com",
])
def test_normalize_base_url_rejects_everything_else(raw):
    with pytest.raises(ValueError):
        sc.normalize_base_url(raw)


def test_bad_address_is_a_usage_error(capsys):
    assert sc.main(["https://user:pw@api.example.com"]) == 2
    assert "Error" in capsys.readouterr().err


def test_report_is_markdown_and_counts_results():
    results = [sc.Result("A", sc.PASS, "fine", 10), sc.Result("B", sc.WARN, "hmm", 20), sc.Result("C", sc.FAIL, "bad", 30)]
    report = sc.format_report(BASE, results)
    assert "| A | PASS | 10 ms | fine |" in report
    assert "3 checks: 1 passed, 1 warning(s), 1 failed." in report
    assert BASE in report
