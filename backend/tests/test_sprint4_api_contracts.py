"""Sprint 4 HTTP contract tests with a fake Supabase connection (#63).

These tests deliberately avoid network calls and real database credentials.
"""
from contextlib import nullcontext

import pytest
import app as api


@pytest.fixture
def client():
    api.app.config["TESTING"] = True
    with api.app.test_client() as test_client:
        yield test_client


def test_risk_areas_empty_database_result(client, monkeypatch):
    monkeypatch.setattr(api, "get_connection", lambda: nullcontext(object()))
    monkeypatch.setattr(api, "get_area_environmental_data", lambda conn: [])
    body = client.get("/api/risk-areas")
    assert body.status_code == 200
    assert body.get_json() == {"status": "success", "source": "supabase", "data": []}


def test_risk_areas_database_failure_is_json_without_fabricated_scores(client, monkeypatch):
    def fail_connection():
        raise RuntimeError("database password=private-value")
    monkeypatch.setattr(api, "get_connection", fail_connection)
    response = client.get("/api/risk-areas")
    assert response.status_code == 503
    body = response.get_json()
    assert body["status"] == "error"
    assert "data" not in body
    assert "private-value" not in response.get_data(as_text=True)


def test_risk_areas_skips_malformed_location_and_keeps_valid_area(client, monkeypatch):
    rows = [
        {"id": 1, "name": "Bad", "latitude": "not-a-number", "longitude": -80},
        {"id": 2, "name": "Valid", "latitude": 50.1, "longitude": -120.3},
    ]
    monkeypatch.setattr(api, "get_connection", lambda: nullcontext(object()))
    monkeypatch.setattr(api, "get_area_environmental_data", lambda conn: rows)
    monkeypatch.setattr(api, "count_nearby_detections", lambda *args: 0)
    monkeypatch.setattr(api, "score_area", lambda inputs: {
        "risk_score": None, "risk_level": None, "is_complete": False,
        "missing_inputs": ["temperature_c"], "coverage": 0,
        "factor_scores": {}, "model_version": "test",
    })
    response = client.get("/api/risk-areas")
    assert response.status_code == 200
    body = response.get_json()
    assert [area["id"] for area in body["data"]] == [2]
    assert body["data"][0]["risk_score"] is None
    assert body["warnings"][0]["code"] == "area_skipped"
    assert body["warnings"][0]["count"] == 1


def test_risk_areas_partial_history_failure_preserves_area_without_fake_history(client, monkeypatch):
    monkeypatch.setattr(api, "get_connection", lambda: nullcontext(object()))
    monkeypatch.setattr(api, "get_area_environmental_data", lambda conn: [
        {"id": 3, "name": "Test", "latitude": 49.0, "longitude": -120.0},
    ])
    def unavailable_history(*args):
        raise TimeoutError("Supabase timeout")
    monkeypatch.setattr(api, "count_nearby_detections", unavailable_history)
    seen = {}
    def fake_score(inputs):
        seen.update(inputs)
        return {
            "risk_score": None, "risk_level": None, "is_complete": False,
            "missing_inputs": ["nearby_detections"], "coverage": 0,
            "factor_scores": {}, "model_version": "test",
        }
    monkeypatch.setattr(api, "score_area", fake_score)
    response = client.get("/api/risk-areas")
    assert response.status_code == 200
    body = response.get_json()
    assert seen["nearby_detections"] is None
    assert body["data"][0]["environmental_factors"]["nearby_detections"] is None
    assert body["warnings"][0]["code"] == "history_unavailable"


def test_detections_empty_database_result_matches_frontend_contract(client, monkeypatch):
    monkeypatch.setattr(api, "get_connection", lambda: nullcontext(object()))
    monkeypatch.setattr(api, "get_classified_detections", lambda conn, limit: {
        "detections": [], "gaps": [], "threshold": 20,
        "counts": {"total": 0, "shown": 0, "potential_wildfire": 0,
                   "low_confidence": 0, "unavailable": 0},
    })
    response = client.get("/api/detections")
    assert response.status_code == 200
    body = response.get_json()
    assert body["source"] == "database"
    assert body["detections"] == []
    assert body["counts"]["shown"] == 0


def test_detections_database_timeout_is_unavailable_not_empty_success(client, monkeypatch):
    def timeout():
        raise TimeoutError("database timed out")
    monkeypatch.setattr(api, "get_connection", timeout)
    response = client.get("/api/detections")
    assert response.status_code == 503
    body = response.get_json()
    assert body["status"] == "unavailable"
    assert "detections" not in body


def test_api_unknown_endpoint_returns_json(client):
    response = client.get("/api/unknown-route")
    assert response.status_code == 404
    assert response.is_json
    assert response.get_json()["status"] == "error"
