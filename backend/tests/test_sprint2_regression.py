"""Sprint 2 regression checks for #20, #22, and the API contract (#30).

All tests use Flask's test client and monkeypatches: no live Supabase required.
"""
from contextlib import nullcontext

import pytest
import app as api
from services.risk_scoring import score_area


@pytest.mark.parametrize("body", [
    {},
    {"temperature_c": None},
    {"temperature_c": "unavailable", "relative_humidity_pct": 110},
])
def test_missing_environmental_inputs_do_not_create_a_fake_risk(body):
    result = score_area(body)
    assert result["risk_score"] is None
    assert result["risk_level"] is None
    assert result["is_complete"] is False
    assert result["missing_inputs"]


def test_risk_area_response_keeps_incomplete_metadata(monkeypatch):
    """Regression: heatmap data must preserve missing inputs for the UI."""
    area = {
        "id": 4, "name": "Incomplete Area", "latitude": 45.4,
        "longitude": -77.5, "temperature_c": 28.0,
        "relative_humidity_pct": None, "wind_speed_kmh": None,
        "precipitation_mm": 0.0, "vegetation_index": None,
        "observed_at": None,
    }
    monkeypatch.setattr(api, "get_connection", lambda: nullcontext(object()))
    monkeypatch.setattr(api, "get_area_environmental_data", lambda conn: [area])
    monkeypatch.setattr(api, "count_nearby_detections", lambda conn, lat, lon: 0)

    with api.app.test_client() as client:
        response = client.get("/api/risk-areas")

    assert response.status_code == 200
    data = response.get_json()["data"][0]
    assert data["id"] == 4
    assert data["latitude"] == 45.4
    assert data["longitude"] == -77.5
    assert data["is_complete"] is False
    assert "relative_humidity_pct" in data["missing_inputs"]
    assert "slope_deg" in data["missing_inputs"]
    assert data["environmental_factors"]["relative_humidity_pct"] is None
    assert data["environmental_factors"]["slope_deg"] is None
    assert data["risk_level"] in ("LOW", "MODERATE", "HIGH", None)


def test_risk_area_database_failure_returns_generic_503(monkeypatch):
    def fail():
        raise RuntimeError("sensitive connection details")

    monkeypatch.setattr(api, "get_connection", fail)
    with api.app.test_client() as client:
        response = client.get("/api/risk-areas")

    assert response.status_code == 503
    body = response.get_json()
    assert body["status"] == "error"
    assert "sensitive connection details" not in str(body)
    assert "Unable to retrieve wildfire risk data" == body["message"]
