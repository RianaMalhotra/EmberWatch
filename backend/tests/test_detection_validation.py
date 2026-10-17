from services.detection_validation import validate_detection

def test_valid_detection():
    data = {
        "latitude": 45.4,
        "longitude": -78.3,
        "timestamp": "2026-10-10T12:00:00Z"
    }

    valid, error = validate_detection(data)

    assert valid is True
    assert error is None


def test_missing_coordinates():
    data = {
        "latitude": None,
        "longitude": -78.3,
        "timestamp": "2026-10-10T12:00:00Z"
    }

    valid, error = validate_detection(data)

    assert valid is False
    assert error == "Missing required field: latitude"


def test_invalid_coordinates():
    data = {
        "latitude": 120,
        "longitude": -78.3,
        "timestamp": "2026-10-10T12:00:00Z"
    }

    valid, error = validate_detection(data)

    assert valid is False
    assert error == "Invalid coordinates"

import pytest


@pytest.mark.parametrize("lat, lon", [
    (float("nan"), -78.3), (45.4, float("nan")),
    (float("inf"), -78.3), (45.4, float("-inf")),
])
def test_non_finite_coordinates_are_invalid(lat, lon):
    data = {"latitude": lat, "longitude": lon, "timestamp": "2026-10-10T12:00:00Z"}

    valid, error = validate_detection(data)

    assert valid is False
    assert error == "Invalid coordinates"
