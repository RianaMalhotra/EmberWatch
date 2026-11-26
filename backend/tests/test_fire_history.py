
"""Unified historical fire records tests for Sprint 5 #54."""
from datetime import datetime, timezone

import pytest
import app as app_module

from services.fire_history import (
    HISTORICAL_FIRES_SQL,
    RECORD_COLUMNS,
    get_historical_fire_records,
)


ARGS = {
    "south": "45",
    "north": "55",
    "west": "-125",
    "east": "-110",
    "start": "2025-07-01T00:00:00Z",
    "end": "2025-08-01T00:00:00Z",
    "limit": "5",
}

SATELLITE_ROW = (
    7, "satellite_detection", 50.123, -120.456,
    datetime(2025, 7, 1, 18, 30, tzinfo=timezone.utc),
    datetime(2025, 7, 1, 18, 35, tzinfo=timezone.utc),
    "NASA FIRMS", 80.0, "high", "MODIS", "Terra", 12.5,
    None, None, [], None, None, None,
)

REPORT_ROW = (
    42, "community_report", 50.123, -120.456,
    datetime(2025, 7, 2, 10, 0, tzinfo=timezone.utc),
    datetime(2025, 7, 2, 10, 5, tzinfo=timezone.utc),
    "public_report", None, None, None, None, None,
    "out",
    datetime(2025, 7, 3, 12, 0, tzinfo=timezone.utc),
    [
        {
            "old_status": "confirmed",
            "new_status": "out",
            "changed_at": "2025-07-03T12:00:00Z",
        }
    ],
    None, 7, "map",
)


class Cursor:
    def __init__(self, rows):
        self.rows = rows
        self.query = None

    def execute(self, sql, params):
        self.query = (sql, params)

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class Connection:
    def __init__(self, rows):
        self.cur = Cursor(rows)

    def cursor(self):
        return self.cur

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_history_query_combines_satellite_and_report_records():
    conn = Connection([SATELLITE_ROW, REPORT_ROW])

    result = get_historical_fire_records(conn, ARGS)

    assert len(result["data"]) == 2
    assert result["data"][0]["event_type"] == "satellite_detection"
    assert result["data"][0]["confidence"] == 80.0
    assert result["data"][1]["event_type"] == "community_report"
    assert result["data"][1]["review_status"] == "out"
    assert result["data"][1]["ended_at"] is not None
    assert result["data"][1]["status_history"][0]["new_status"] == "out"

    # Community-report coordinates must be approximate.
    assert result["data"][1]["latitude"] == 50.12
    assert result["data"][1]["longitude"] == -120.46

    assert result["truncated"] is False
    assert result["filters"]["limit"] == 5


def test_history_query_uses_parameterized_filters_and_both_sources():
    conn = Connection([SATELLITE_ROW])

    get_historical_fire_records(conn, ARGS)

    sql, params = conn.cur.query

    assert sql == HISTORICAL_FIRES_SQL
    assert "public.detections" in sql
    assert "public.fire_reports" in sql
    assert "public.fire_report_audit" in sql
    assert "UNION ALL" in sql
    assert "'confirmed'" in sql
    assert "'out'" in sql
    assert "detected_at >= %(start)s" in sql
    assert "observed_at < %(end)s" in sql
    assert params["south"] == 45
    assert params["north"] == 55
    assert params["limit"] == 6


def test_history_query_reports_truncation():
    conn = Connection([SATELLITE_ROW] * 6)

    result = get_historical_fire_records(conn, ARGS)

    assert result["truncated"] is True
    assert len(result["data"]) == 5


def test_history_endpoint_returns_combined_records(monkeypatch):
    monkeypatch.setattr(
        app_module,
        "get_connection",
        lambda: Connection([SATELLITE_ROW, REPORT_ROW]),
    )

    response = app_module.app.test_client().get(
        "/api/fires/history",
        query_string=ARGS,
    )

    assert response.status_code == 200

    body = response.get_json()
    assert body["status"] == "success"
    assert len(body["data"]) == 2
    assert body["data"][0]["event_type"] == "satellite_detection"
    assert body["data"][1]["event_type"] == "community_report"


def test_invalid_history_filters_return_400_without_database_connection(monkeypatch):
    def should_not_connect():
        raise AssertionError("Database should not be queried")

    monkeypatch.setattr(app_module, "get_connection", should_not_connect)

    response = app_module.app.test_client().get("/api/fires/history")

    assert response.status_code == 400


def test_history_endpoint_returns_503_on_database_failure(monkeypatch):
    def fail():
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(app_module, "get_connection", fail)

    response = app_module.app.test_client().get(
        "/api/fires/history",
        query_string=ARGS,
    )

    assert response.status_code == 503
    assert "database unavailable" not in response.get_data(as_text=True)
