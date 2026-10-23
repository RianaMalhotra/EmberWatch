import math
from datetime import date, timedelta

import pytest

from load_environment_to_db import (
    collect, checked, elevation_url, insert_observations, load_areas, noon_observation,
    observation_row, slope_from_elevations, terrain_points, terrain_rows, upsert_areas,
    weather_request,
)

DAY = date(2026, 8, 15)
AREA = {"name": "Kelowna", "province": "BC", "latitude": 49.888, "longitude": -119.496}


def hourly_response(day=DAY, offset_hours=-7, rain_per_hour=0.5, **noon_overrides):
    """Fake Open-Meteo hourly response for day-1 00:00 .. day 23:00 local time."""
    start = day - timedelta(days=1)
    times = [f"{(start + timedelta(days=h // 24)).isoformat()}T{h % 24:02d}:00" for h in range(48)]
    temperature = [20.0] * 48
    humidity = [50.0] * 48
    wind = [10.0] * 48
    noon = 24 + 12
    temperature[noon], humidity[noon], wind[noon] = 31.5, 18.0, 27.0
    hourly = {
        "time": times,
        "temperature_2m": temperature,
        "relative_humidity_2m": humidity,
        "wind_speed_10m": wind,
        "precipitation": [rain_per_hour] * 48,
    }
    for variable, value in noon_overrides.items():
        hourly[variable][noon] = value
    return {"utc_offset_seconds": offset_hours * 3600, "hourly": hourly}


def test_areas_csv_is_valid_and_has_reasons():
    areas = load_areas()
    names = [a["name"] for a in areas]
    assert len(names) == len(set(names)) >= 10
    assert all(41 < a["latitude"] < 70 and -142 < a["longitude"] < -52 for a in areas)  # Canada


def test_noon_values_and_24h_rain_ending_at_noon():
    obs = noon_observation(hourly_response(), DAY)
    assert obs["temperature_c"] == 31.5
    assert obs["relative_humidity_pct"] == 18.0
    assert obs["wind_speed_kmh"] == 27.0
    assert obs["precipitation_mm"] == 12.0           # 24 hours x 0.5 mm
    assert obs["observed_at"] == "2026-08-15T19:00:00+00:00"  # 12:00 PDT (UTC-7)
    assert obs["vegetation_index"] is None           # no NDVI source: missing, not invented


def test_missing_and_out_of_range_values_become_none():
    obs = noon_observation(hourly_response(relative_humidity_2m=140.0, wind_speed_10m=None), DAY)
    assert obs["relative_humidity_pct"] is None
    assert obs["wind_speed_kmh"] is None
    assert obs["temperature_c"] == 31.5


def test_partial_rain_window_is_none():
    response = hourly_response()
    response["hourly"]["precipitation"][30] = None
    assert noon_observation(response, DAY)["precipitation_mm"] is None


def test_missing_noon_hour_returns_none():
    assert noon_observation(hourly_response(day=DAY - timedelta(days=3)), DAY) is None


def test_checked_rejects_text_and_nan():
    assert checked("temperature_c", "abc") is None
    assert checked("temperature_c", float("nan")) is None
    assert checked("temperature_c", "12.5") == 12.5


def test_slope_from_elevations():
    assert slope_from_elevations(100, 100, 100, 100, 100) == 0
    # 500 m rise across 500 m east-west -> 45 degrees
    assert math.isclose(slope_from_elevations(0, 0, 0, 250, -250), 45.0)
    assert slope_from_elevations(100, None, 100, 100, 100) is None


def test_terrain_points_are_250m_apart():
    centre, north, south, east, west = terrain_points(60.0, -115.0)
    assert math.isclose((north[0] - centre[0]) * 111320, 250)
    assert math.isclose((east[1] - centre[1]) * 111320 * math.cos(math.radians(60)), 250)
    assert south[0] < centre[0] and west[1] < centre[1]


def test_terrain_rows_and_url():
    rows = terrain_rows([AREA], [400, 410, 390, 400, 400], "2026-10-18T00:00:00+00:00")
    assert rows[0]["elevation_m"] == 400
    assert math.isclose(rows[0]["slope_deg"], math.degrees(math.atan(20 / 500)))
    with pytest.raises(ValueError):
        terrain_rows([AREA], [400], "now")
    assert elevation_url(terrain_points(49.888, -119.496)).count(",") == 8
    with pytest.raises(ValueError):
        elevation_url([(0, 0)] * 101)


def test_weather_request_picks_archive_or_forecast():
    url, source = weather_request(AREA, DAY, today=DAY + timedelta(days=30))
    assert source == "open-meteo-archive" and url.startswith("https://archive-api.open-meteo.com")
    assert "start_date=2026-08-14" in url and "end_date=2026-08-15" in url
    url, source = weather_request(AREA, DAY, today=DAY + timedelta(days=1))
    assert source == "open-meteo-forecast" and url.startswith("https://api.open-meteo.com/v1/forecast")


def test_collect_uses_fetch_for_terrain_and_weather():
    def fake_fetch(url):
        if "elevation" in url:
            return {"elevation": [400, 410, 390, 400, 400]}
        return hourly_response()

    terrain, observations = collect([AREA], [DAY], today=DAY + timedelta(days=30), fetch=fake_fetch)
    assert terrain[0]["name"] == "Kelowna"
    (name, obs, source), = observations
    assert (name, source, obs["temperature_c"]) == ("Kelowna", "open-meteo-archive", 31.5)


class FakeCursor:
    def __init__(self, ids=None):
        self.calls = []
        self.rowcount = 0
        self.ids = ids or []

    def execute(self, sql, params):
        self.calls.append(("execute", sql, params))
        self.rowcount = 1

    def executemany(self, sql, rows):
        self.calls.append(("executemany", sql, rows))

    def fetchall(self):
        return self.ids

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeConnection:
    def __init__(self, cur):
        self.cur = cur
        self.committed = False

    def cursor(self):
        return self.cur

    def commit(self):
        self.committed = True


def test_upsert_areas_returns_ids():
    conn = FakeConnection(FakeCursor(ids=[(7, "Kelowna")]))
    assert upsert_areas(conn, [AREA]) == {"Kelowna": 7}
    assert conn.cur.calls[0][2] == [("Kelowna", "BC", 49.888, -119.496)]
    assert conn.committed


def test_insert_observations_skips_duplicates_with_on_conflict():
    conn = FakeConnection(FakeCursor())
    row = observation_row(7, noon_observation(hourly_response(), DAY), "open-meteo-archive")
    assert row[0] == 7 and row[6] is None and row[7] == "open-meteo-archive"
    assert insert_observations(conn, [row]) == 1
    assert "on conflict (area_id, observed_at, source) do nothing" in conn.cur.calls[0][1]
    assert conn.committed
