"""Regression contracts for detection and risk boundary conditions."""
import math
import pytest
from services.detection_pipeline import classify_detections, clamp_limit
from services.risk_scoring import score_area, WEIGHTS

@pytest.mark.parametrize("raw,expected", [(None,200),("abc",200),("0",1),("-20",1),("100000",1000),("12",12)])
def test_detection_limit_is_bounded(raw,expected):
    assert clamp_limit(raw) == expected

def test_missing_and_malformed_detection_rows_are_counted_not_fabricated():
    result = classify_detections([None, {}, {"id": 8, "confidence": 99}], min_confidence=20)
    assert result["counts"]["total"] == 3
    assert result["counts"]["shown"] == 0
    assert result["counts"]["unavailable"] == 3
    assert len(result["gaps"]) == 3

@pytest.mark.parametrize("invalid",[float("nan"),float("inf"),float("-inf"),True,"80",101,-1])
def test_invalid_humidity_is_missing(invalid):
    data = {"relative_humidity_pct":invalid}
    result = score_area(data)
    assert "relative_humidity_pct" in result["missing_inputs"]
    assert "relative_humidity_pct" not in result["factor_scores"]

def test_exact_half_coverage_produces_score():
    # Humidity (0.20) + temperature (0.15) + wind (0.15) = 0.50
    result = score_area({"relative_humidity_pct":20, "temperature_c":30, "wind_speed_kmh":20})
    assert result["coverage"] == pytest.approx(0.5)
    assert result["risk_score"] is not None
    assert result["is_complete"] is False

def test_score_is_bounded_for_valid_extreme_inputs():
    values = {"temperature_c":60,"relative_humidity_pct":0,"wind_speed_kmh":300,
              "precipitation_mm":0,"vegetation_index":1,"slope_deg":90,
              "nearby_detections":1000000}
    result = score_area(values)
    assert result["is_complete"]
    assert 0 <= result["risk_score"] <= 100
    assert sum(WEIGHTS.values()) == pytest.approx(1)
