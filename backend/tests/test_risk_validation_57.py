"""Validation tests for the risk model (#57): deterministic output,
explainability, missing-data states, and risk kept separate from detection
confidence."""
import json
import math
import random
from contextlib import nullcontext

import pytest

import app as api
from services.risk_scoring import (
    MIN_COVERAGE,
    MODEL_VERSION,
    WEIGHTS,
    risk_level,
    score_area,
)

COMPLETE = {
    "temperature_c": 31.0,
    "relative_humidity_pct": 22.0,
    "wind_speed_kmh": 28.0,
    "precipitation_mm": 0.4,
    "vegetation_index": 0.5,
    "slope_deg": 14.0,
    "nearby_detections": 120,
}


@pytest.fixture
def client():
    api.app.config["TESTING"] = True
    with api.app.test_client() as test_client:
        yield test_client


# ---------------------------------------------------------------------------
# Deterministic output
# ---------------------------------------------------------------------------
def test_same_input_gives_identical_output_every_time():
    first = score_area(COMPLETE)
    for _ in range(200):
        assert score_area(COMPLETE) == first


def test_input_order_does_not_matter():
    expected = score_area(COMPLETE)
    keys = list(COMPLETE)
    rng = random.Random(57)
    for _ in range(20):
        rng.shuffle(keys)
        assert score_area({k: COMPLETE[k] for k in keys}) == expected


def test_score_area_does_not_change_its_input():
    inputs = dict(COMPLETE)
    score_area(inputs)
    assert inputs == COMPLETE


def test_output_survives_json_round_trip():
    result = score_area(COMPLETE)
    assert json.loads(json.dumps(result)) == result


def test_api_and_model_agree(client):
    body = client.post("/api/risk-score", json=COMPLETE).get_json()
    assert body["data"] == score_area(COMPLETE)


# ---------------------------------------------------------------------------
# Explainability: the score can be rebuilt from what the API returns
# ---------------------------------------------------------------------------
def rebuilt_score(result):
    used = result["factor_scores"]
    coverage = sum(WEIGHTS[name] for name in used)
    return sum(WEIGHTS[name] * score for name, score in used.items()) / coverage


@pytest.mark.parametrize("drop", [[], ["vegetation_index"], ["wind_speed_kmh", "slope_deg"]])
def test_score_equals_weighted_factor_scores(drop):
    inputs = {k: v for k, v in COMPLETE.items() if k not in drop}
    result = score_area(inputs)
    # factor scores are rounded to 0.1, so allow a small rounding gap
    assert math.isclose(result["risk_score"], rebuilt_score(result), abs_tol=0.1)


def test_every_factor_is_either_scored_or_listed_missing():
    result = score_area({**COMPLETE, "wind_speed_kmh": None})
    scored, missing = set(result["factor_scores"]), set(result["missing_inputs"])
    assert scored | missing == set(WEIGHTS)
    assert not scored & missing


def test_level_matches_score_and_version_is_reported():
    result = score_area(COMPLETE)
    assert result["risk_level"] == risk_level(result["risk_score"])
    assert result["model_version"] == MODEL_VERSION


def test_weights_are_documented_values():
    """docs/risk-model.md lists these weights; change both together."""
    assert WEIGHTS == {
        "temperature_c": 0.15, "relative_humidity_pct": 0.20, "wind_speed_kmh": 0.15,
        "precipitation_mm": 0.10, "vegetation_index": 0.10, "slope_deg": 0.05,
        "nearby_detections": 0.25,
    }


# ---------------------------------------------------------------------------
# Missing-data states
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("name", list(WEIGHTS))
def test_each_missing_factor_is_reported_with_its_coverage(name):
    result = score_area({**COMPLETE, name: None})
    assert result["is_complete"] is False
    assert result["missing_inputs"] == [name]
    assert result["coverage"] == round(1 - WEIGHTS[name], 2)
    assert result["risk_score"] is not None


def test_coverage_exactly_at_minimum_still_scores():
    # history 0.25 + humidity 0.20 + slope 0.05 = 0.50
    result = score_area({"nearby_detections": 10, "relative_humidity_pct": 30, "slope_deg": 5})
    assert result["coverage"] == MIN_COVERAGE
    assert result["risk_score"] is not None


def test_coverage_below_minimum_gives_no_score_or_level():
    result = score_area({"nearby_detections": 10, "relative_humidity_pct": 30})  # 0.45
    assert result["risk_score"] is None
    assert result["risk_level"] is None
    assert result["factor_scores"]  # what was available is still shown


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf"), True, "30", [30]])
@pytest.mark.parametrize("name", ["temperature_c", "nearby_detections"])
def test_non_measurements_count_as_missing(name, bad):
    result = score_area({**COMPLETE, name: bad})
    assert name in result["missing_inputs"]
    assert name not in result["factor_scores"]


def test_infinite_detection_count_is_not_scored_as_maximum():
    """Regression for #57: inf used to pass the open-ended range and score 100."""
    result = score_area({**COMPLETE, "nearby_detections": float("inf")})
    assert result["factor_scores"].get("nearby_detections") is None


# ---------------------------------------------------------------------------
# Risk is not detection confidence
# ---------------------------------------------------------------------------
def test_confidence_fields_do_not_change_risk():
    base = score_area(COMPLETE)
    assert score_area({**COMPLETE, "confidence": 99, "confidence_class": "high"}) == base
    assert score_area({**COMPLETE, "confidence": 1, "confidence_class": "low"}) == base


def test_risk_areas_and_detections_use_separate_fields(client, monkeypatch):
    area = {"id": 1, "name": "A", "latitude": 50.0, "longitude": -120.0, "observed_at": None,
            **{k: v for k, v in COMPLETE.items() if k != "nearby_detections"}}
    monkeypatch.setattr(api, "get_connection", lambda: nullcontext(object()))
    monkeypatch.setattr(api, "get_area_environmental_data", lambda conn: [area])
    monkeypatch.setattr(api, "count_nearby_detections", lambda conn, lat, lon: 120)
    monkeypatch.setattr(api, "get_classified_detections", lambda conn, limit: {
        "detections": [{"id": 9, "latitude": 50.0, "longitude": -120.0,
                        "detected_at": "2026-08-01T00:00:00Z", "confidence": 87,
                        "classification": "potential_wildfire"}],
        "gaps": [], "threshold": 20, "counts": {},
    })

    risk_record = client.get("/api/risk-areas").get_json()["data"][0]
    detection = client.get("/api/detections").get_json()["detections"][0]

    assert "confidence" not in risk_record and "classification" not in risk_record
    assert "risk_score" not in detection and "risk_level" not in detection
    assert risk_record["risk_level"] in ("LOW", "MODERATE", "HIGH")
