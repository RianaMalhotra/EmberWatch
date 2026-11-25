"""Tests for the detections export (#56). No database needed: a fake connection stands in."""

import csv

import export_detections as export


class FakeCursor:
    def __init__(self, rows, log):
        self.rows, self.log = rows, log

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params):
        self.log.append((sql, params))

    def __iter__(self):
        return iter(self.rows)


class FakeConnection:
    def __init__(self, rows):
        self.rows, self.log, self.cursor_names = rows, [], []

    def cursor(self, name=None):
        self.cursor_names.append(name)
        return FakeCursor(self.rows, self.log)


def test_year_bounds_are_utc_calendar_years():
    assert export.year_bounds(2023) == ("2023-01-01T00:00:00Z", "2024-01-01T00:00:00Z")


def test_export_year_writes_the_columns_the_nbac_check_reads(tmp_path):
    conn = FakeConnection([(51.5, -100.25, "2023-06-04T00:05:00Z", 80.0), (52.0, -101.0, "2023-07-01T10:00:00Z", 15.0)])
    path = tmp_path / "detections_2023.csv"
    assert export.export_year(conn, 2023, str(path)) == 2
    assert path.read_text(encoding="utf-8").splitlines()[0] == "latitude,longitude,timestamp,confidence"

    import evaluate_against_nbac as nbac
    lats, lons, confidences, skipped = nbac.load_detections(str(path), 2023)
    assert (lats, lons, confidences, skipped) == ([51.5, 52.0], [-100.25, -101.0], [80.0, 15.0], 0)


def test_export_only_asks_for_archive_rows_in_the_year_and_streams(tmp_path):
    conn = FakeConnection([])
    export.export_year(conn, 2024, str(tmp_path / "x.csv"))
    sql, params = conn.log[0]
    assert params == ("NASA FIRMS", "2024-01-01T00:00:00Z", "2025-01-01T00:00:00Z")
    assert "at time zone 'UTC'" in sql and "source = %s" in sql
    assert conn.cursor_names == ["export_2024"]  # named cursor = streamed, not loaded at once
    assert not any(word in sql.lower() for word in ("insert", "update", "delete"))


def test_usage_errors_do_not_touch_the_database():
    import pytest
    with pytest.raises(SystemExit):
        export.main([])
    with pytest.raises(SystemExit):
        export.main(["twenty"])
    with pytest.raises(SystemExit):
        export.main(["2023", "--out-dir"])
