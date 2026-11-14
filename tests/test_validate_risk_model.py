"""Tests for ml/validate_risk_model.py (#57), with a fake Open-Meteo so no
network is needed."""
from datetime import date, datetime, timedelta

import validate_risk_model as vrm


def hourly_response(day, temp, rh, wind, rain_per_hour):
    """Open-Meteo-style hourly data for the day before and the day itself."""
    start = datetime.combine(day - timedelta(days=1), datetime.min.time())
    times = [(start + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(48)]
    return {
        "utc_offset_seconds": -6 * 3600,
        "hourly": {
            "time": times,
            "temperature_2m": [temp] * 48,
            "relative_humidity_2m": [rh] * 48,
            "wind_speed_10m": [wind] * 48,
            "precipitation": [rain_per_hour] * 48,
        },
    }


def fake_fetch_factory(weather_by_date):
    def fetch(url):
        if "elevation" in url:
            return {"elevation": [500.0, 520.0, 480.0, 510.0, 490.0]}
        day = date.fromisoformat(url.split("end_date=")[1][:10])
        return hourly_response(day, *weather_by_date[day])
    return fetch


EVENT = {"name": "Testville", "province": "AB", "latitude": 55.0, "longitude": -115.0,
         "event_date": date(2023, 8, 16), "event": "test fire", "reference": "test"}

WEATHER = {
    date(2023, 8, 16): (33.0, 15.0, 40.0, 0.0),   # hot, dry, windy fire day
    date(2022, 8, 16): (22.0, 45.0, 10.0, 0.0),   # ordinary summer day
    date(2023, 1, 15): (-20.0, 80.0, 5.0, 0.1),   # winter
}


def test_events_file_loads_with_real_dates():
    events = vrm.load_events()
    assert len(events) >= 5
    for event in events:
        assert isinstance(event["event_date"], date)
        assert -90 <= event["latitude"] <= 90 and -180 <= event["longitude"] <= 180
        assert event["reference"]


def test_case_dates():
    assert vrm.case_dates(date(2023, 8, 16)) == {
        "fire_day": date(2023, 8, 16),
        "prev_year": date(2022, 8, 16),
        "off_season": date(2023, 1, 15),
    }
    assert vrm.case_dates(date(2024, 2, 29))["prev_year"] == date(2023, 2, 28)


def test_run_scores_three_days_without_fire_history():
    rows = vrm.run([EVENT], fetch=fake_fetch_factory(WEATHER), today=date(2026, 11, 12))

    assert [r["case"] for r in rows] == ["fire_day", "prev_year", "off_season"]
    for r in rows:
        assert r["nearby_detections"] is None          # no leakage from the detections table
        assert "nearby_detections" in r["missing_inputs"]
        assert "vegetation_index" in r["missing_inputs"]
        assert r["coverage"] == 0.65
        assert r["weather_source"] == "open-meteo-archive"
        assert r["slope_deg"] is not None

    scores = {r["case"]: r["risk_score"] for r in rows}
    assert scores["fire_day"] > scores["prev_year"] > scores["off_season"]
    assert rows[0]["risk_level"] == "HIGH"


def test_summary_counts_fire_days_above_controls():
    rows = vrm.run([EVENT], fetch=fake_fetch_factory(WEATHER), today=date(2026, 11, 12))
    summary = vrm.summarize(rows)

    assert summary["events"] == 1
    assert summary["fire_day_levels"]["HIGH"] == 1
    assert summary["fire_day_above_prev_year"] == (1, 1)
    assert summary["fire_day_above_off_season"] == (1, 1)


def test_missing_weather_gives_no_score_and_is_not_compared():
    rows = [
        {"event": "A", "case": "fire_day", "risk_score": None, "risk_level": None},
        {"event": "A", "case": "prev_year", "risk_score": 30.0, "risk_level": "LOW"},
        {"event": "A", "case": "off_season", "risk_score": 10.0, "risk_level": "LOW"},
    ]
    summary = vrm.summarize(rows)
    assert summary["fire_day_above_prev_year"] == (0, 0)
    assert summary["fire_day_levels"][None] == 1


def test_csv_is_written(tmp_path):
    rows = vrm.run([EVENT], fetch=fake_fetch_factory(WEATHER), today=date(2026, 11, 12))
    out = tmp_path / "results" / "risk.csv"
    vrm.write_csv(rows, str(out))
    lines = out.read_text().splitlines()
    assert lines[0].startswith("event,case,date")
    assert len(lines) == 4
