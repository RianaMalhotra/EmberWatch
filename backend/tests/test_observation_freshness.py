"""#49: every risk area says when its weather was observed and whether that is stale."""
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone

import pytest

import app as api
from tests.conftest import FROZEN_NOW

AREA = {
    "id": 1, "name": "Area", "latitude": 50.0, "longitude": -100.0,
    "slope_deg": 5.0, "temperature_c": 30.0, "relative_humidity_pct": 20.0,
    "wind_speed_kmh": 20.0, "precipitation_mm": 0.0, "vegetation_index": 0.5,
}


@pytest.fixture
def get_areas(monkeypatch):
    def run(*observed_values):
        areas = [{**AREA, "id": i + 1, "observed_at": v} for i, v in enumerate(observed_values)]
        monkeypatch.setattr(api, "get_connection", lambda: nullcontext(object()))
        monkeypatch.setattr(api, "get_area_environmental_data", lambda conn: areas)
        monkeypatch.setattr(api, "count_nearby_detections", lambda conn, lat, lon: 1)
        return api.app.test_client().get("/api/risk-areas").get_json()

    return run


def hours_ago(h):
    return (FROZEN_NOW - timedelta(hours=h)).isoformat()


def test_recent_observation_is_reported_with_its_age_and_not_stale(get_areas):
    body = get_areas(hours_ago(30))
    area = body["data"][0]

    assert area["observed_at"] == hours_ago(30)
    assert area["observation_age_hours"] == 30.0
    assert area["observation_stale"] is False
    assert "warnings" not in body


def test_old_observation_is_flagged_and_warned_about(get_areas):
    body = get_areas(hours_ago(24 * 10), hours_ago(5))

    old, fresh = body["data"]
    assert old["observation_stale"] is True and fresh["observation_stale"] is False
    warning = next(w for w in body["warnings"] if w["code"] == "stale_observations")
    assert warning["count"] == 1
    assert old["risk_score"] is not None  # flagged, not silently rescored or hidden


def test_datetime_from_the_database_is_sent_as_iso_text(get_areas):
    moment = FROZEN_NOW - timedelta(hours=2)
    area = get_areas(moment)["data"][0]
    assert area["observed_at"] == moment.isoformat()
    assert area["observation_age_hours"] == 2.0


def test_naive_times_are_read_as_utc(get_areas):
    area = get_areas("2026-10-16T12:00:00")["data"][0]
    assert area["observation_age_hours"] == 12.0


@pytest.mark.parametrize("value", [None, "not a date", "", 12345])
def test_missing_or_unreadable_time_is_unknown_not_invented(get_areas, value):
    area = get_areas(value)["data"][0]
    assert area["observed_at"] is None
    assert area["observation_age_hours"] is None
    assert area["observation_stale"] is None


def test_stale_threshold_can_be_configured(get_areas, monkeypatch):
    monkeypatch.setenv("STALE_OBSERVATION_DAYS", "1")
    assert get_areas(hours_ago(30))["data"][0]["observation_stale"] is True


@pytest.mark.parametrize("bad", ["abc", "0", "-2", ""])
def test_bad_stale_setting_falls_back_to_the_default(get_areas, monkeypatch, bad):
    monkeypatch.setenv("STALE_OBSERVATION_DAYS", bad)
    assert get_areas(hours_ago(30))["data"][0]["observation_stale"] is False
