"""Tests for the detection classification pipeline (#17) and GET /api/detections (#18)."""
from datetime import datetime, timezone

import pytest

import app as app_module
from services.detection_pipeline import (
    DEFAULT_LIMIT,
    LOW_CONFIDENCE,
    MAX_LIMIT,
    POTENTIAL_WILDFIRE,
    classify_detection,
    classify_detections,
    clamp_limit,
    fetch_recent_detections,
)


def make_row(**overrides):
    row = {
        "id": 1,
        "latitude": 50.1,
        "longitude": -120.3,
        "detected_at": "2025-07-01T18:30:00Z",
        "confidence": 80,
        "confidence_class": "high",
        "instrument": "MODIS",
        "satellite": "Terra",
        "frp": 12.5,
    }
    row.update(overrides)
    return row


# --- classify_detection ---

def test_confident_detection_is_potential_wildfire():
    record, reason = classify_detection(make_row(confidence=80), min_confidence=20)
    assert reason is None
    assert record["classification"] == POTENTIAL_WILDFIRE
    assert record["meets_threshold"] is True
    assert record["latitude"] == 50.1 and record["longitude"] == -120.3
    assert record["timestamp"] == "2025-07-01T18:30:00Z"
    assert record["confidence"] == 80


def test_detection_at_threshold_counts_as_potential_wildfire():
    record, _ = classify_detection(make_row(confidence=20), min_confidence=20)
    assert record["classification"] == POTENTIAL_WILDFIRE


def test_low_confidence_detection_is_kept_but_labelled():
    record, reason = classify_detection(make_row(confidence=10), min_confidence=20)
    assert reason is None
    assert record["classification"] == LOW_CONFIDENCE
    assert record["meets_threshold"] is False


def test_threshold_comes_from_config_when_not_given(monkeypatch):
    monkeypatch.setenv("MIN_DETECTION_CONFIDENCE", "90")
    record, _ = classify_detection(make_row(confidence=80))
    assert record["classification"] == LOW_CONFIDENCE


def test_database_datetime_is_converted_to_utc_text():
    row = make_row(detected_at=datetime(2025, 7, 1, 18, 30, tzinfo=timezone.utc))
    record, reason = classify_detection(row, min_confidence=20)
    assert reason is None
    assert record["timestamp"] == "2025-07-01T18:30:00Z"


@pytest.mark.parametrize("overrides, reason", [
    ({"latitude": None}, "Missing required field: latitude"),
    ({"longitude": None}, "Missing required field: longitude"),
    ({"latitude": 120}, "Invalid coordinates"),
    ({"detected_at": None}, "Missing required field: timestamp"),
    ({"detected_at": "yesterday"}, "Invalid timestamp"),
    ({"confidence": None}, "Missing confidence"),
    ({"confidence": "high"}, "Missing confidence"),
    ({"confidence": True}, "Missing confidence"),
    ({"confidence": 150}, "Invalid confidence"),
])
def test_unusable_rows_are_reported_not_fabricated(overrides, reason):
    record, found = classify_detection(make_row(**overrides), min_confidence=20)
    assert record is None
    assert found == reason


def test_non_dict_row_is_unavailable():
    assert classify_detection(None, 20) == (None, "Detection data is unavailable")


def test_missing_frp_stays_none():
    record, _ = classify_detection(make_row(frp=None), min_confidence=20)
    assert record["frp"] is None


# --- classify_detections ---

def test_classify_detections_counts_and_gaps():
    rows = [
        make_row(id=1, confidence=90),
        make_row(id=2, confidence=5),
        make_row(id=3, latitude=None),
    ]
    result = classify_detections(rows, min_confidence=20)
    assert [d["id"] for d in result["detections"]] == [1, 2]
    assert result["gaps"] == [{"id": 3, "reason": "Missing required field: latitude"}]
    assert result["threshold"] == 20
    assert result["counts"] == {
        "total": 3, "shown": 2, "potential_wildfire": 1, "low_confidence": 1, "unavailable": 1,
    }


def test_classify_detections_empty_input():
    result = classify_detections([], min_confidence=20)
    assert result["detections"] == [] and result["gaps"] == []
    assert result["counts"]["total"] == 0


# --- limit handling and database access (fake connection) ---

@pytest.mark.parametrize("value, expected", [
    (None, DEFAULT_LIMIT), ("abc", DEFAULT_LIMIT), ("10", 10),
    ("0", 1), ("-5", 1), ("999999", MAX_LIMIT),
])
def test_clamp_limit(value, expected):
    assert clamp_limit(value) == expected


class FakeCursor:
    def __init__(self, rows):
        self.rows, self.calls = rows, []

    def execute(self, sql, params):
        self.calls.append((sql, params))

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeConnection:
    def __init__(self, rows):
        self.cur = FakeCursor(rows)

    def cursor(self):
        return self.cur

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


DB_ROW = (7, 50.1, -120.3, datetime(2025, 7, 1, 18, 30, tzinfo=timezone.utc), 80.0, "high", "MODIS", "Terra", None)


def test_fetch_recent_detections_maps_columns_and_limits():
    conn = FakeConnection([DB_ROW])
    rows = fetch_recent_detections(conn, limit="5")
    assert rows[0]["id"] == 7 and rows[0]["satellite"] == "Terra" and rows[0]["frp"] is None
    sql, params = conn.cur.calls[0]
    assert params == {"limit": 5}
    assert "order by detected_at desc" in sql


# --- GET /api/detections ---

@pytest.fixture
def client():
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as client:
        yield client


def test_detections_endpoint_success(client, monkeypatch):
    monkeypatch.setattr(app_module, "get_connection", lambda: FakeConnection([DB_ROW]))
    monkeypatch.setenv("MIN_DETECTION_CONFIDENCE", "20")
    response = client.get("/api/detections?limit=1")
    assert response.status_code == 200
    body = response.get_json()
    assert body["status"] == "success"
    assert body["source"] == "database"
    assert body["threshold"] == 20
    assert body["gaps"] == []
    detection = body["detections"][0]
    assert detection["latitude"] == 50.1
    assert detection["timestamp"] == "2025-07-01T18:30:00Z"
    assert detection["confidence"] == 80.0
    assert detection["classification"] == POTENTIAL_WILDFIRE


def test_detections_endpoint_reports_gaps(client, monkeypatch):
    bad_row = (8, None, -120.3, datetime(2025, 7, 1, tzinfo=timezone.utc), 50.0, "nominal", None, None, None)
    monkeypatch.setattr(app_module, "get_connection", lambda: FakeConnection([DB_ROW, bad_row]))
    body = client.get("/api/detections").get_json()
    assert len(body["detections"]) == 1
    assert body["gaps"] == [{"id": 8, "reason": "Missing required field: latitude"}]
    assert body["counts"]["unavailable"] == 1


def test_detections_endpoint_unavailable_when_database_fails(client, monkeypatch):
    def broken():
        raise RuntimeError("host=secret.example.com password=hunter2")
    monkeypatch.setattr(app_module, "get_connection", broken)
    response = client.get("/api/detections")
    assert response.status_code == 503
    body = response.get_json()
    assert body["status"] == "unavailable"
    assert "detections" not in body
    assert "secret" not in body["message"] and "hunter2" not in body["message"]


def test_detections_endpoint_rejects_bad_threshold_config(client, monkeypatch):
    monkeypatch.setattr(app_module, "get_connection", lambda: FakeConnection([DB_ROW]))
    monkeypatch.setenv("MIN_DETECTION_CONFIDENCE", "abc")
    response = client.get("/api/detections")
    assert response.status_code == 500
    assert response.get_json()["status"] == "error"


# --- NaN / infinity (reviewer feedback) ---

NAN, INF = float("nan"), float("inf")


@pytest.mark.parametrize("overrides, reason", [
    ({"latitude": NAN}, "Invalid coordinates"),
    ({"longitude": NAN}, "Invalid coordinates"),
    ({"latitude": INF}, "Invalid coordinates"),
    ({"longitude": -INF}, "Invalid coordinates"),
    ({"confidence": NAN}, "Invalid confidence"),
    ({"confidence": INF}, "Invalid confidence"),
    ({"confidence": -INF}, "Invalid confidence"),
])
def test_non_finite_values_are_rejected(overrides, reason):
    record, found = classify_detection(make_row(**overrides), min_confidence=20)
    assert record is None
    assert found == reason


@pytest.mark.parametrize("bad_frp", [NAN, INF, -INF, "12", True])
def test_non_finite_frp_becomes_none(bad_frp):
    record, _ = classify_detection(make_row(frp=bad_frp), min_confidence=20)
    assert record["frp"] is None


def test_endpoint_never_sends_nan_or_infinity(client, monkeypatch):
    rows = [
        DB_ROW,
        (9, 50.1, -120.3, datetime(2025, 7, 1, tzinfo=timezone.utc), NAN, "high", None, None, None),
        (10, INF, -120.3, datetime(2025, 7, 1, tzinfo=timezone.utc), 50.0, "high", None, None, None),
        (11, 50.1, -120.3, datetime(2025, 7, 1, tzinfo=timezone.utc), 50.0, "high", None, None, NAN),
    ]
    monkeypatch.setattr(app_module, "get_connection", lambda: FakeConnection(rows))
    response = client.get("/api/detections")
    assert response.status_code == 200
    # Plain NaN / Infinity are not valid JSON, so they must never appear in the body.
    assert b"NaN" not in response.data and b"Infinity" not in response.data
    body = response.get_json()
    assert [d["id"] for d in body["detections"]] == [7, 11]
    assert body["detections"][1]["frp"] is None
    assert [g["id"] for g in body["gaps"]] == [9, 10]
