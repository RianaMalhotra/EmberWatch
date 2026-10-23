
import pytest
from app import app
from contextlib import nullcontext

@pytest.fixture
def client():
    app.config["TESTING"] = True

    with app.test_client() as client:
        yield client


def test_health_endpoint(client):
    response = client.get("/api/health")

    assert response.status_code == 200

    data = response.get_json()

    assert data["status"] == "ok"
    assert data["message"] == "Wildfire Detection API is running"


def test_risk_areas_endpoint(client, monkeypatch):
    """The risk areas endpoint returns its expected API contract without a live DB."""
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

    # Avoid opening a real database connection.
    monkeypatch.setattr(
        "app.get_connection",
        lambda: nullcontext(object()),
    )
    monkeypatch.setattr(
        "app.get_area_environmental_data",
        lambda conn: [sample_area],
    )
    monkeypatch.setattr(
        "app.count_nearby_detections",
        lambda conn, latitude, longitude: 2,
    )
    monkeypatch.setattr(
        "app.score_area",
        lambda inputs: sample_risk,
    )

    response = client.get("/api/risk-areas")

    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "success"
    assert data["source"] == "supabase"
    assert len(data["data"]) == 1

    area = data["data"][0]
    assert area["id"] == 1
    assert area["latitude"] == 43.6532
    assert area["longitude"] == -79.3832
    assert area["risk_level"] == "HIGH"
    assert area["risk_score"] == 75.0
    assert area["environmental_factors"]["temperature_c"] == 32.0
    assert area["environmental_factors"]["nearby_detections"] == 2
    assert area["environmental_factors"]["slope_deg"] is None

def test_risk_areas_passes_stored_slope_to_model(client, monkeypatch):
    """areas.slope_deg (#68) reaches the risk model and the response."""
    area = {
        "id": 2, "name": "Kelowna", "latitude": 49.888, "longitude": -119.496,
        "slope_deg": 12.5, "temperature_c": 30.0, "relative_humidity_pct": 20.0,
        "wind_speed_kmh": 25.0, "precipitation_mm": 0.0, "vegetation_index": None,
        "observed_at": "2026-08-15T19:00:00+00:00",
    }
    seen = {}

    def fake_score(inputs):
        seen.update(inputs)
        return {"risk_score": 70.0, "risk_level": "HIGH", "is_complete": False,
                "missing_inputs": ["vegetation_index"], "coverage": 0.9,
                "factor_scores": {}, "model_version": "test"}

    monkeypatch.setattr("app.get_connection", lambda: nullcontext(object()))
    monkeypatch.setattr("app.get_area_environmental_data", lambda conn: [area])
    monkeypatch.setattr("app.count_nearby_detections", lambda conn, latitude, longitude: 0)
    monkeypatch.setattr("app.score_area", fake_score)

    data = client.get("/api/risk-areas").get_json()

    assert seen["slope_deg"] == 12.5
    assert data["data"][0]["environmental_factors"]["slope_deg"] == 12.5
