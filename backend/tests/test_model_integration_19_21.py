"""Model-integration tests for #19 (confidence threshold) and #21 (risk model).

Earlier tests check each piece on its own and mock the database helpers.
These run the real pieces together through /api/risk-areas:

    environment threshold (#19) -> nearby-detection count -> score_area (#21)
    -> API response (and risk_assessments row)

Only the database connection is faked, so the SQL column mapping, the
threshold lookup, and the scoring model are all exercised for real.
"""
from contextlib import nullcontext

import pytest

import app as api
from services.risk_scoring import (
    MODEL_VERSION,
    NEARBY_DETECTIONS_SQL,
    save_assessment,
    score_area,
)

# Rows in the exact column order of LATEST_AREA_ENVIRONMENT_SQL:
# id, name, latitude, longitude, slope_deg, temperature_c, relative_humidity_pct,
# wind_speed_kmh, precipitation_mm, vegetation_index, observed_at
HOT_DRY = (1, "Hot dry area", 49.89, -119.50, 25.0, 34.0, 12.0, 45.0, 0.0, 0.75, "2026-08-15T19:00:00+00:00")
# Real Kelowna observation loaded by #68 (Oct 18): no NDVI source yet.
KELOWNA = (2, "Kelowna", 49.888, -119.496, 0.72, 12.4, 45.0, 1.9, 0.0, None, "2026-10-18T19:00:00+00:00")
# Area with no observation yet: LEFT JOIN gives NULLs.
NO_DATA = (3, "New area", 45.42, -75.70, None, None, None, None, None, None, None)

# Confidence values of detections "within 50 km" of every area.
NEARBY_CONFIDENCES = [5, 15, 25, 45, 60, 80, 95] * 100  # 700 detections


class FakeCursor:
    def __init__(self):
        self.params = []

    def execute(self, sql, params):
        assert sql == NEARBY_DETECTIONS_SQL
        self.params.append(params)
        self._count = sum(1 for c in NEARBY_CONFIDENCES if c >= params["min_confidence"])

    def fetchone(self):
        return (self._count,)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeResult:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows


class FakeConnection:
    """Answers the area query with `rows` and counts detections by threshold."""

    def __init__(self, rows):
        self.rows, self.cur, self.committed = rows, FakeCursor(), False

    def execute(self, sql):
        assert "FROM public.areas" in sql
        return FakeResult(self.rows)

    def cursor(self):
        return self.cur

    def commit(self):
        self.committed = True


def get_risk_areas(monkeypatch, rows, threshold=None):
    conn = FakeConnection(rows)
    monkeypatch.setattr(api, "get_connection", lambda: nullcontext(conn))
    if threshold is None:
        monkeypatch.delenv("MIN_DETECTION_CONFIDENCE", raising=False)
    else:
        monkeypatch.setenv("MIN_DETECTION_CONFIDENCE", str(threshold))
    with api.app.test_client() as client:
        response = client.get("/api/risk-areas")
    return response, conn


def by_id(response):
    return {area["id"]: area for area in response.get_json()["data"]}


# --- #21: the real model through the real API ---------------------------------

def test_complete_hot_dry_area_is_scored_high(monkeypatch):
    response, _ = get_risk_areas(monkeypatch, [HOT_DRY])

    area = by_id(response)[1]
    assert response.status_code == 200
    assert area["risk_level"] == "HIGH"
    assert area["is_complete"] is True
    assert area["missing_inputs"] == []
    assert area["coverage"] == 1.0
    assert area["model_version"] == MODEL_VERSION
    assert area["environmental_factors"]["slope_deg"] == 25.0  # column mapping reaches the model


def test_real_area_without_ndvi_is_scored_but_marked_incomplete(monkeypatch):
    response, _ = get_risk_areas(monkeypatch, [KELOWNA])

    area = by_id(response)[2]
    assert area["risk_level"] in ("LOW", "MODERATE", "HIGH")
    assert area["is_complete"] is False
    assert area["missing_inputs"] == ["vegetation_index"]
    assert area["coverage"] == pytest.approx(0.9)
    assert area["environmental_factors"]["vegetation_index"] is None  # never invented
    assert area["observed_at"] == "2026-10-18T19:00:00+00:00"


def test_area_without_observations_gets_no_score(monkeypatch):
    response, _ = get_risk_areas(monkeypatch, [NO_DATA])

    area = by_id(response)[3]
    assert area["risk_score"] is None
    assert area["risk_level"] is None
    assert area["is_complete"] is False
    assert area["coverage"] < 0.5
    assert area["environmental_factors"]["nearby_detections"] == 500  # history still reported


def test_api_result_equals_direct_model_call(monkeypatch):
    """The endpoint must not change what the model computes."""
    response, _ = get_risk_areas(monkeypatch, [KELOWNA])
    area = by_id(response)[2]

    direct = score_area(area["environmental_factors"])
    for key in ("risk_score", "risk_level", "is_complete", "missing_inputs", "coverage", "factor_scores"):
        assert area[key] == direct[key]


def test_same_data_gives_same_result_every_time(monkeypatch):
    first, _ = get_risk_areas(monkeypatch, [HOT_DRY, KELOWNA, NO_DATA])
    second, _ = get_risk_areas(monkeypatch, [HOT_DRY, KELOWNA, NO_DATA])
    assert first.get_json() == second.get_json()


def test_api_result_can_be_saved_as_assessment(monkeypatch):
    response, conn = get_risk_areas(monkeypatch, [KELOWNA])
    area = by_id(response)[2]

    class SaveCursor(FakeCursor):
        def execute(self, sql, params):
            self.params.append(params)

        def fetchone(self):
            return (11,)

    conn.cur = SaveCursor()
    assert save_assessment(conn, area["id"], area) == 11
    assert conn.cur.params[0] == (2, area["risk_score"], area["risk_level"], False, ["vegetation_index"], MODEL_VERSION)
    assert conn.committed


# --- #19 -> #21: the confidence threshold feeds the risk model -----------------

def test_default_threshold_is_used_for_history(monkeypatch):
    response, conn = get_risk_areas(monkeypatch, [HOT_DRY])

    assert conn.cur.params[0]["min_confidence"] == 20.0
    assert conn.cur.params[0]["radius_m"] == 50_000
    assert by_id(response)[1]["environmental_factors"]["nearby_detections"] == 500  # 25,45,60,80,95


def test_threshold_from_environment_reaches_history_count(monkeypatch):
    response, conn = get_risk_areas(monkeypatch, [HOT_DRY], threshold=60)

    assert conn.cur.params[0]["min_confidence"] == 60.0
    assert by_id(response)[1]["environmental_factors"]["nearby_detections"] == 300  # 60,80,95


def test_stricter_threshold_never_raises_risk(monkeypatch):
    scores = []
    for threshold in (0, 20, 50, 90):
        response, _ = get_risk_areas(monkeypatch, [KELOWNA], threshold=threshold)
        scores.append(by_id(response)[2]["risk_score"])
    assert scores == sorted(scores, reverse=True)
    assert scores[0] > scores[-1]


@pytest.mark.parametrize("bad", ["abc", "150", "-5"])
def test_bad_threshold_config_gives_error_not_fake_risk(monkeypatch, bad):
    response, _ = get_risk_areas(monkeypatch, [HOT_DRY], threshold=bad)

    assert response.status_code == 503
    body = response.get_json()
    assert body["status"] == "error"
    assert "data" not in body
