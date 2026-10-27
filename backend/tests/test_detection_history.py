"""History API contract and SQL query tests for Sprint 3 #46."""
from datetime import datetime, timezone

import pytest
import app as app_module
from services.detection_history import HISTORY_SQL, history_params, get_historical_detections

ARGS = {
    "south": "45", "north": "55", "west": "-125", "east": "-110",
    "start": "2025-07-01T00:00:00Z", "end": "2025-08-01T00:00:00Z",
    "limit": "5",
}
DB_ROW = (7, 50.1, -120.3, datetime(2025, 7, 1, 18, 30, tzinfo=timezone.utc),
          80.0, "high", "MODIS", "Terra", None)


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


def test_history_query_maps_records_and_uses_parameterized_bounds():
    conn = Connection([DB_ROW])
    result = get_historical_detections(conn, ARGS, min_confidence=70)
    assert [d["id"] for d in result["detections"]] == [7]
    assert result["detections"][0]["timestamp"] == "2025-07-01T18:30:00Z"
    assert result["filters"]["limit"] == 5
    sql, params = conn.cur.query
    assert sql == HISTORY_SQL
    assert params["south"] == 45 and params["north"] == 55
    assert params["start"].tzinfo == timezone.utc
    assert "detected_at < %(end)s" in sql


@pytest.mark.parametrize("changes", [
    {"south": "nan"}, {"north": "100"}, {"west": "10", "east": "-10"},
    {"start": "2025-07-01T00:00:00"}, {"end": "not-a-date"},
    {"start": "2025-09-01T00:00:00Z"}, {"end": "2025-06-01T00:00:00Z"},
])
def test_invalid_history_filters_are_rejected(changes):
    with pytest.raises(ValueError):
        history_params({**ARGS, **changes})


def test_history_endpoint_returns_classified_records(monkeypatch):
    monkeypatch.setattr(app_module, "get_connection", lambda: Connection([DB_ROW]))
    monkeypatch.setenv("MIN_DETECTION_CONFIDENCE", "70")
    client = app_module.app.test_client()
    response = client.get("/api/detections/history", query_string=ARGS)
    assert response.status_code == 200
    body = response.get_json()
    assert body["source"] == "database"
    assert body["detections"][0]["classification"] == "potential_wildfire"
    assert body["filters"]["end"] == "2025-08-01T00:00:00Z"


def test_invalid_query_returns_400_without_database_connection(monkeypatch):
    def should_not_connect():
        raise AssertionError("Database should not be queried")
    monkeypatch.setattr(app_module, "get_connection", should_not_connect)
    response = app_module.app.test_client().get("/api/detections/history")
    assert response.status_code == 400


def test_history_endpoint_returns_503_on_database_failure(monkeypatch):
    def fail():
        raise RuntimeError("password=private")
    monkeypatch.setattr(app_module, "get_connection", fail)
    response = app_module.app.test_client().get("/api/detections/history", query_string=ARGS)
    assert response.status_code == 503
    assert "private" not in response.get_data(as_text=True)
