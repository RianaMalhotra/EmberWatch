import pytest

from config import DEFAULT_MIN_DETECTION_CONFIDENCE, get_min_detection_confidence
from services.detection_filter import filter_detections, passes_threshold


def test_default_threshold_used_when_env_not_set(monkeypatch):
    monkeypatch.delenv("MIN_DETECTION_CONFIDENCE", raising=False)
    assert get_min_detection_confidence() == DEFAULT_MIN_DETECTION_CONFIDENCE


def test_threshold_read_from_environment(monkeypatch):
    monkeypatch.setenv("MIN_DETECTION_CONFIDENCE", "65")
    assert get_min_detection_confidence() == 65.0


@pytest.mark.parametrize("bad_value", ["abc", "-1", "101"])
def test_invalid_threshold_rejected(monkeypatch, bad_value):
    monkeypatch.setenv("MIN_DETECTION_CONFIDENCE", bad_value)
    with pytest.raises(ValueError):
        get_min_detection_confidence()


def test_detection_at_threshold_passes():
    assert passes_threshold({"confidence": 50}, 50) is True


def test_detection_below_threshold_fails():
    assert passes_threshold({"confidence": 49.9}, 50) is False


@pytest.mark.parametrize("detection", [{}, {"confidence": None}, {"confidence": "high"}, {"confidence": True}, None])
def test_missing_or_invalid_confidence_never_passes(detection):
    assert passes_threshold(detection, 0) is False


def test_filter_splits_detections():
    detections = [{"id": 1, "confidence": 90}, {"id": 2, "confidence": 20}, {"id": 3}]
    accepted, rejected = filter_detections(detections, min_confidence=50)
    assert [d["id"] for d in accepted] == [1]
    assert [d["id"] for d in rejected] == [2, 3]


def test_filter_uses_configured_threshold(monkeypatch):
    monkeypatch.setenv("MIN_DETECTION_CONFIDENCE", "80")
    accepted, rejected = filter_detections([{"confidence": 85}, {"confidence": 75}])
    assert len(accepted) == 1 and len(rejected) == 1


@pytest.mark.parametrize("confidence", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_confidence_never_passes(confidence):
    assert passes_threshold({"confidence": confidence}, 0) is False
