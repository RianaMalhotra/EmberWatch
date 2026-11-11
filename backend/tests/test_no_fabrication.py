"""#49 acceptance criterion: no fabricated detections or risk scores.

Whatever subset of inputs is missing, a score appears only when at least half
of the model's weight is backed by real data, and it never lists a factor that
was not supplied. Detections that cannot be verified are reported as gaps.
"""
from contextlib import nullcontext
from itertools import combinations

import pytest

import app as api
from services.detection_pipeline import classify_detections
from services.risk_scoring import MIN_COVERAGE, WEIGHTS

DB_INPUTS = ["temperature_c", "relative_humidity_pct", "wind_speed_kmh",
             "precipitation_mm", "vegetation_index", "slope_deg"]
FULL_AREA = {
    "id": 1, "name": "Area", "latitude": 50.0, "longitude": -100.0,
    "temperature_c": 30.0, "relative_humidity_pct": 20.0, "wind_speed_kmh": 25.0,
    "precipitation_mm": 0.0, "vegetation_index": 0.5, "slope_deg": 10.0,
    "observed_at": "2026-10-16T12:00:00+00:00",
}
ALL_SUBSETS = [c for n in range(len(DB_INPUTS) + 1) for c in combinations(DB_INPUTS, n)]


@pytest.fixture
def client():
    api.app.config["TESTING"] = True
    return api.app.test_client()


@pytest.mark.parametrize("history_works", [True, False])
@pytest.mark.parametrize("missing", ALL_SUBSETS, ids=lambda m: "missing-" + ("none" if not m else "+".join(m)))
def test_score_only_exists_when_enough_real_inputs_back_it(client, monkeypatch, missing, history_works):
    area = {k: (None if k in missing else v) for k, v in FULL_AREA.items()}

    def history(conn, lat, lon):
        if not history_works:
            raise RuntimeError("history down")
        return 5

    monkeypatch.setattr(api, "get_connection", lambda: nullcontext(object()))
    monkeypatch.setattr(api, "get_area_environmental_data", lambda conn: [area])
    monkeypatch.setattr(api, "count_nearby_detections", history)

    body = client.get("/api/risk-areas").get_json()
    result = body["data"][0]

    present = [k for k in DB_INPUTS if k not in missing] + (["nearby_detections"] if history_works else [])
    expected_missing = [k for k in WEIGHTS if k not in present]
    coverage = sum(WEIGHTS[k] for k in present)

    assert set(result["factor_scores"]) == set(present)          # nothing invented
    assert set(result["missing_inputs"]) == set(expected_missing)
    assert result["is_complete"] is (not expected_missing)
    if coverage + 1e-9 < MIN_COVERAGE:
        assert result["risk_score"] is None and result["risk_level"] is None
    else:
        assert 0 <= result["risk_score"] <= 100 and result["risk_level"] is not None


def test_area_with_no_observation_at_all_has_no_score(client, monkeypatch):
    """The LEFT JOIN returns all-NULL weather for an area with no observation."""
    area = {**FULL_AREA, **{k: None for k in DB_INPUTS if k != "slope_deg"}, "observed_at": None}
    monkeypatch.setattr(api, "get_connection", lambda: nullcontext(object()))
    monkeypatch.setattr(api, "get_area_environmental_data", lambda conn: [area])
    monkeypatch.setattr(api, "count_nearby_detections", lambda conn, lat, lon: 0)

    result = client.get("/api/risk-areas").get_json()["data"][0]

    assert result["risk_score"] is None and result["risk_level"] is None
    assert result["is_complete"] is False


@pytest.mark.parametrize("bad", [
    {"latitude": None}, {"longitude": None}, {"detected_at": None}, {"confidence": None},
    {"confidence": float("nan")}, {"latitude": 999}, {"detected_at": "not a date"},
])
def test_unverifiable_detection_becomes_a_gap_never_a_marker(bad):
    row = {"id": 7, "latitude": 50.0, "longitude": -100.0, "detected_at": "2026-10-10T12:00:00Z",
           "confidence": 80.0, "confidence_class": "high", "instrument": "MODIS",
           "satellite": "Terra", "frp": 3.0}
    result = classify_detections([{**row, **bad}], min_confidence=20)

    assert result["detections"] == []
    assert result["gaps"][0]["id"] == 7
    assert result["counts"] == {"total": 1, "shown": 0, "potential_wildfire": 0,
                                "low_confidence": 0, "unavailable": 1}
