"""Failure-handling tests for #25 (data-source failures).

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


# --------------------------------------------------------------------------
# #25: external data-source (database) failures
# --------------------------------------------------------------------------

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
        # The other six inputs are real, so a score is still produced.
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
