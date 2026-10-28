"""Failure-handling tests for #25 (data-source failures) and #26 (API and
model-processing failures).

Every test uses Flask's test client and monkeypatches, so no live Supabase or
network is needed. The common rule being checked: a failure is reported
honestly (a warning, an "unavailable" area, or a clear error status) and never
leaks internal details or turns into an invented value.
"""
from contextlib import nullcontext

import pytest

import app as api
from db import DatabaseNotConfigured

SECRET = "postgresql://user:hunter2@db.internal:5432/postgres"


def make_area(area_id, **overrides):
    area = {
        "id": area_id, "name": f"Area {area_id}",
        "latitude": 45.0 + area_id, "longitude": -77.0,
        "slope_deg": 10.0, "temperature_c": 30.0,
        "relative_humidity_pct": 25.0, "wind_speed_kmh": 20.0,
        "precipitation_mm": 0.0, "vegetation_index": 0.5,
        "observed_at": "2026-10-16T12:00:00+00:00",
    }
    area.update(overrides)
    return area


@pytest.fixture
def client():
    api.app.config["TESTING"] = True
    with api.app.test_client() as test_client:
        yield test_client


@pytest.fixture
def patch_areas(monkeypatch):
    """Serve the given areas without a database; returns the history-call log."""
    def install(areas, history=lambda lat, lon: 3):
        calls = []

        def fake_history(conn, latitude, longitude):
            calls.append((latitude, longitude))
            return history(latitude, longitude)

        monkeypatch.setattr(api, "get_connection", lambda: nullcontext(object()))
        monkeypatch.setattr(api, "get_area_environmental_data", lambda conn: areas)
        monkeypatch.setattr(api, "count_nearby_detections", fake_history)
        return calls

    return install


# #25: external data-source (database) failures
def test_healthy_response_has_no_warnings(client, patch_areas):
    patch_areas([make_area(1)])
    body = client.get("/api/risk-areas").get_json()

    assert body["status"] == "success"
    assert "warnings" not in body
    assert body["data"][0]["is_complete"] is True


def test_fire_history_failure_still_returns_areas_marked_incomplete(client, patch_areas):
    def broken_history(lat, lon):
        raise RuntimeError(SECRET)

    patch_areas([make_area(1), make_area(2)], history=broken_history)
    response = client.get("/api/risk-areas")

    assert response.status_code == 200
    body = response.get_json()
    assert len(body["data"]) == 2

    for area in body["data"]:
        assert area["environmental_factors"]["nearby_detections"] is None
        assert "nearby_detections" in area["missing_inputs"]
        assert area["is_complete"] is False
        # The other six inputs are real, so a score is still produced
        assert isinstance(area["risk_score"], float)
        assert area["risk_level"] in ("LOW", "MODERATE", "HIGH")

    assert [w["code"] for w in body["warnings"]] == ["history_unavailable"]
    assert SECRET not in response.get_data(as_text=True)


def test_fire_history_is_not_retried_for_every_area_after_a_failure(client, patch_areas):
    def broken_history(lat, lon):
        raise RuntimeError("connection lost")

    calls = patch_areas([make_area(i) for i in (1, 2, 3, 4)], history=broken_history)
    body = client.get("/api/risk-areas").get_json()

    assert len(calls) == 1  # one failure, then the rest skip the lookup
    assert len(body["data"]) == 4


def test_area_query_failure_returns_503_without_invented_data(client, monkeypatch):
    def broken_query(conn):
        raise RuntimeError(SECRET)

    monkeypatch.setattr(api, "get_connection", lambda: nullcontext(object()))
    monkeypatch.setattr(api, "get_area_environmental_data", broken_query)

    response = client.get("/api/risk-areas")
    body = response.get_json()

    assert response.status_code == 503
    assert body == {"status": "error", "message": "Unable to retrieve wildfire risk data"}
    assert SECRET not in response.get_data(as_text=True)


def test_missing_database_configuration_returns_503_not_the_setup_message(client, monkeypatch):
    def not_configured():
        raise DatabaseNotConfigured("DATABASE_URL is not set. Copy backend/.env.example ...")

    monkeypatch.setattr(api, "get_connection", not_configured)

    risk = client.get("/api/risk-areas")
    detections = client.get("/api/detections")

    assert risk.status_code == 503
    assert detections.status_code == 503
    assert detections.get_json() == {"status": "unavailable", "message": "Detection data is unavailable"}
    assert "DATABASE_URL" not in risk.get_data(as_text=True)
    assert "DATABASE_URL" not in detections.get_data(as_text=True)


def test_detections_database_failure_does_not_leak_details(client, monkeypatch):
    def broken_connection():
        raise RuntimeError(SECRET)

    monkeypatch.setattr(api, "get_connection", broken_connection)
    response = client.get("/api/detections")

    assert response.status_code == 503
    assert SECRET not in response.get_data(as_text=True)
    assert "detections" not in response.get_json()  # no fabricated detections


def test_failure_while_closing_the_connection_keeps_the_gathered_results(client, monkeypatch):
    class ConnectionThatFailsOnClose:
        def __enter__(self):
            return object()

        def __exit__(self, *exc_info):
            raise RuntimeError("could not commit: connection closed")

    monkeypatch.setattr(api, "get_connection", lambda: ConnectionThatFailsOnClose())
    monkeypatch.setattr(api, "get_area_environmental_data", lambda conn: [make_area(1)])
    monkeypatch.setattr(api, "count_nearby_detections", lambda conn, lat, lon: 2)

    response = client.get("/api/risk-areas")

    assert response.status_code == 200
    assert len(response.get_json()["data"]) == 1


@pytest.mark.parametrize("bad_location", [
    {"latitude": None},
    {"longitude": None},
    {"latitude": "45.0"},
    {"latitude": float("nan")},
    {"longitude": float("inf")},
    {"latitude": True},
])
def test_area_without_a_usable_location_is_left_out_with_a_warning(client, patch_areas, bad_location):
    patch_areas([make_area(1), make_area(2, **bad_location), make_area(3)])
    body = client.get("/api/risk-areas").get_json()

    assert [a["id"] for a in body["data"]] == [1, 3]
    warning = next(w for w in body["warnings"] if w["code"] == "area_skipped")
    assert warning["count"] == 1


def test_bad_confidence_threshold_is_a_config_error_not_a_quiet_fallback(client, patch_areas):
    """A misconfigured MIN_DETECTION_CONFIDENCE must not look like an outage:
    no 200 with incomplete scores, but the same 503 error as a failed query."""
    def bad_threshold(lat, lon):
        raise ValueError("MIN_DETECTION_CONFIDENCE must be between 0 and 100, got 150")

    patch_areas([make_area(1)], history=bad_threshold)
    response = client.get("/api/risk-areas")
    body = response.get_json()

    assert response.status_code == 503
    assert body["status"] == "error"
    assert "data" not in body and "warnings" not in body
    assert "MIN_DETECTION_CONFIDENCE" not in response.get_data(as_text=True)



# #26: API and model-processing failures
def test_model_failure_for_one_area_does_not_break_the_others(client, patch_areas, monkeypatch):
    patch_areas([make_area(1), make_area(2), make_area(3)])
    real_score = api.score_area

    def flaky_score(inputs):
        if inputs["temperature_c"] == 99:
            raise ValueError("model exploded")
        return real_score(inputs)

    monkeypatch.setattr(api, "score_area", flaky_score)
    monkeypatch.setattr(api, "get_area_environmental_data",
                        lambda conn: [make_area(1), make_area(2, temperature_c=99), make_area(3)])

    response = client.get("/api/risk-areas")
    body = response.get_json()

    assert response.status_code == 200
    first, broken, third = body["data"]

    assert first["risk_level"] is not None and "processing_error" not in first
    assert third["risk_level"] is not None

    # The failed area is marked unavailable: no score, no level, not "complete"
    assert broken["id"] == 2
    assert broken["risk_score"] is None
    assert broken["risk_level"] is None
    assert broken["is_complete"] is False
    assert broken["processing_error"] is True
    assert broken["environmental_factors"]["temperature_c"] == 99  # real data still shown
    assert "model exploded" not in response.get_data(as_text=True)

    warning = next(w for w in body["warnings"] if w["code"] == "scoring_failed")
    assert warning["count"] == 1


def test_model_failure_response_keeps_the_full_area_shape(client, patch_areas, monkeypatch):
    patch_areas([make_area(1)])

    def always_fails(inputs):
        raise RuntimeError("boom")

    monkeypatch.setattr(api, "score_area", always_fails)
    area = client.get("/api/risk-areas").get_json()["data"][0]

    # The frontend reads these keys, so a failed area must still have them all
    for key in ("id", "name", "latitude", "longitude", "risk_score", "risk_level",
                "is_complete", "missing_inputs", "coverage", "factor_scores",
                "model_version", "environmental_factors", "observed_at"):
        assert key in area
    # The inputs were present; the model failed, so nothing is reported as missing
    assert area["missing_inputs"] == []


def test_risk_score_endpoint_reports_model_failure_as_json_500(client, monkeypatch):
    def always_fails(inputs):
        raise RuntimeError(SECRET)

    monkeypatch.setattr(api, "score_area", always_fails)
    response = client.post("/api/risk-score", json={"temperature_c": 30})

    assert response.status_code == 500
    assert response.is_json
    assert response.get_json() == {"status": "error", "message": "Risk score could not be calculated"}
    assert SECRET not in response.get_data(as_text=True)


def test_risk_score_endpoint_works_when_fire_history_lookup_fails(client, monkeypatch):
    def broken_connection():
        raise RuntimeError(SECRET)

    monkeypatch.setattr(api, "get_connection", broken_connection)
    response = client.post("/api/risk-score", json={
        "temperature_c": 30, "relative_humidity_pct": 20, "wind_speed_kmh": 30,
        "precipitation_mm": 0, "vegetation_index": 0.5,
        "latitude": 45.0, "longitude": -77.0,
    })

    assert response.status_code == 200
    data = response.get_json()["data"]
    assert "nearby_detections" in data["missing_inputs"]
    assert data["is_complete"] is False


def test_unexpected_error_returns_generic_json_500(client, monkeypatch):
    def explode():
        raise RuntimeError(SECRET)

    monkeypatch.setattr(api, "check_database", explode)
    response = client.get("/api/health/db")

    assert response.status_code == 500
    assert response.is_json
    assert response.get_json() == {"status": "error", "message": "Unexpected server error"}
    assert SECRET not in response.get_data(as_text=True)


def test_unknown_api_route_returns_json_404(client):
    response = client.get("/api/does-not-exist")

    assert response.status_code == 404
    assert response.get_json() == {"status": "error", "message": "Not Found"}


def test_wrong_method_returns_json_405(client):
    response = client.post("/api/health")

    assert response.status_code == 405
    assert response.get_json()["status"] == "error"
