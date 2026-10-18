"""Sprint 1 API integration checks; no live Supabase credentials required."""
import app as app_module
from contextlib import nullcontext

def test_risk_areas_frontend_contract(monkeypatch):
    """Verify the response shape expected by the frontend without Supabase."""
    sample_area = {
        "id": 1,
        "name": "Toronto Test Area",
        "latitude": 43.6532,
        "longitude": -79.3832,
        "temperature_c": 32.0,
        "relative_humidity_pct": 25.0,
        "wind_speed_kmh": 35.0,
        "precipitation_mm": 0.0,
        "vegetation_index": 0.25,
        "observed_at": "2026-10-16T12:00:00",
    }

    sample_risk = {
        "risk_score": 75.0,
        "risk_level": "HIGH",
        "is_complete": False,
        "missing_inputs": ["slope_deg"],
        "coverage": 0.8,
        "factor_scores": {},
        "model_version": "test",
    }

    monkeypatch.setattr(
        app_module,
        "get_connection",
        lambda: nullcontext(object()),
    )
    monkeypatch.setattr(
        app_module,
        "get_area_environmental_data",
        lambda conn: [sample_area],
    )
    monkeypatch.setattr(
        app_module,
        "count_nearby_detections",
        lambda conn, latitude, longitude: 2,
    )
    monkeypatch.setattr(
        app_module,
        "score_area",
        lambda inputs: sample_risk,
    )

    with app_module.app.test_client() as client:
        response = client.get("/api/risk-areas")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["status"] == "success"
    assert payload["source"] == "supabase"
    assert isinstance(payload["data"], list)

    for area in payload["data"]:
        assert isinstance(area["id"], int)
        assert isinstance(area["latitude"], (int, float))
        assert isinstance(area["longitude"], (int, float))
        assert -90 <= area["latitude"] <= 90
        assert -180 <= area["longitude"] <= 180
        assert area["risk_level"] in {"LOW", "MODERATE", "HIGH"}
        assert isinstance(area["environmental_factors"], dict)
        assert "temperature_c" in area["environmental_factors"]
        assert "relative_humidity_pct" in area["environmental_factors"]
        assert "wind_speed_kmh" in area["environmental_factors"]
        assert "precipitation_mm" in area["environmental_factors"]
        assert "vegetation_index" in area["environmental_factors"]



def test_database_health_success(monkeypatch):
    monkeypatch.setattr(app_module, "check_database", lambda: (True, None))
    with app_module.app.test_client() as client:
        response = client.get("/api/health/db")
    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"


def test_database_health_failure(monkeypatch):
    monkeypatch.setattr(app_module, "check_database", lambda: (False, "Database is unavailable"))
    with app_module.app.test_client() as client:
        response = client.get("/api/health/db")
    assert response.status_code == 503
    assert response.get_json()["status"] == "unavailable"
