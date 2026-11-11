"""#49: Open-Meteo timeouts, malformed replies and missing inputs.

The loader must never write a partial or invented observation: a failed fetch
stops the run before the database is touched, and a missing value is stored as
NULL (which the risk model reports as a missing input).
"""
import http.client
import io
import socket
import sys
import urllib.error
from datetime import date

import pytest

import load_environment_to_db as loader
from load_environment_to_db import DataSourceError, collect, fetch_json, main, noon_observation
from test_load_environment_to_db import AREA, DAY, hourly_response


class Reply(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False


def serve(monkeypatch, body=None, error=None):
    def fake_urlopen(request, timeout=None):
        if error is not None:
            raise error
        return Reply(body)

    monkeypatch.setattr(loader.urllib.request, "urlopen", fake_urlopen)


# ---- API timeout / unreachable -------------------------------------------------

@pytest.mark.parametrize("error", [
    socket.timeout("timed out"),
    TimeoutError("timed out"),
    urllib.error.URLError("Name or service not known"),
    urllib.error.HTTPError("http://x", 503, "Service Unavailable", {}, None),
    ConnectionResetError("reset by peer"),
])
def test_network_failure_propagates_as_oserror(monkeypatch, error):
    serve(monkeypatch, error=error)
    with pytest.raises(OSError):
        fetch_json("http://example.invalid")


def test_fetch_passes_the_timeout_to_urlopen(monkeypatch):
    seen = {}

    def fake_urlopen(request, timeout=None):
        seen["timeout"] = timeout
        return Reply(b"{}")

    monkeypatch.setattr(loader.urllib.request, "urlopen", fake_urlopen)
    fetch_json("http://example.invalid", timeout=7)
    assert seen["timeout"] == 7


# ---- malformed response --------------------------------------------------------

@pytest.mark.parametrize("body", [
    b"<html>502 Bad Gateway</html>",
    b"",
    b'{"hourly": {"time": [',          # cut off mid-reply
    b"\xff\xfe not utf-8",
    b"[1, 2, 3]",                      # JSON, but not an object
    b"null",
    b'{"error": true, "reason": "Cannot initialize WeatherVariable"}',
])
def test_unusable_body_raises_data_source_error(monkeypatch, body):
    serve(monkeypatch, body=body)
    with pytest.raises(DataSourceError):
        fetch_json("http://example.invalid")


def test_connection_cut_mid_reply_is_a_data_source_error(monkeypatch):
    serve(monkeypatch, error=http.client.IncompleteRead(b"partial"))
    with pytest.raises(DataSourceError):
        fetch_json("http://example.invalid")


@pytest.mark.parametrize("bad", [[], "text", None, 5])
def test_non_object_weather_reply_is_rejected(bad):
    with pytest.raises(DataSourceError):
        noon_observation(bad, DAY)


@pytest.mark.parametrize("elevation_reply", [
    {},                                  # no "elevation" key
    {"elevation": "oops"},
    {"elevation": [1.0, "x", 3.0, 4.0, 5.0]},
    {"elevation": [1.0, 2.0]},           # wrong count for one area
])
def test_malformed_elevation_reply_stops_the_run(elevation_reply):
    with pytest.raises(DataSourceError):
        collect([AREA], [DAY], date(2026, 8, 30), fetch=lambda url: elevation_reply)


@pytest.fixture
def no_database(monkeypatch):
    """Fail the test if the script gets as far as connecting to the database."""
    class Boom:
        @staticmethod
        def connect(*a, **k):
            raise AssertionError("database must not be touched after a failed fetch")

    monkeypatch.setitem(sys.modules, "psycopg", Boom)


ARGS = ["--date", "2026-08-15", "--skip-terrain"]


def test_main_exits_cleanly_and_writes_nothing_on_timeout(monkeypatch, no_database):
    serve(monkeypatch, error=socket.timeout("timed out"))
    with pytest.raises(SystemExit) as stopped:
        main(ARGS)
    assert "Could not reach Open-Meteo" in str(stopped.value)
    assert "Nothing was written" in str(stopped.value)


@pytest.mark.parametrize("body", [b"<html>oops</html>", b"[]", b'{"error": true, "reason": "x"}'])
def test_main_exits_cleanly_and_writes_nothing_on_malformed_reply(monkeypatch, no_database, body):
    serve(monkeypatch, body=body)
    with pytest.raises(SystemExit) as stopped:
        main(ARGS)
    assert "unusable data" in str(stopped.value)
    assert "Nothing was written" in str(stopped.value)


# ---- missing environmental inputs ---------------------------------------------

def test_missing_variable_series_become_null_not_zero():
    response = hourly_response()
    del response["hourly"]["wind_speed_10m"]
    response["hourly"]["relative_humidity_2m"] = None

    observation = noon_observation(response, DAY)

    assert observation["wind_speed_kmh"] is None
    assert observation["relative_humidity_pct"] is None
    assert observation["temperature_c"] == 31.5           # the rest is still real
    assert observation["vegetation_index"] is None         # no NDVI source


@pytest.mark.parametrize("response", [
    {"utc_offset_seconds": 0},
    {"utc_offset_seconds": 0, "hourly": None},
    {"utc_offset_seconds": 0, "hourly": ["not", "a", "dict"]},
    {"utc_offset_seconds": 0, "hourly": {"time": "2026-08-15T12:00"}},
])
def test_reply_without_usable_hourly_data_gives_no_observation(response):
    assert noon_observation(response, DAY) is None


def test_unusable_utc_offset_skips_the_day_instead_of_guessing():
    response = hourly_response()
    response["utc_offset_seconds"] = "-25200"
    assert noon_observation(response, DAY) is None


def test_missing_elevation_gives_null_terrain_not_zero():
    replies = {"elevation": [100.0, None, 100.0, 100.0, 100.0]}
    terrain, _ = collect([AREA], [], date(2026, 8, 30), fetch=lambda url: replies)

    assert terrain[0]["slope_deg"] is None
    assert terrain[0]["elevation_m"] == 100.0
