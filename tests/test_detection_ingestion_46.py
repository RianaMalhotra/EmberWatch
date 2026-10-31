"""Ingestion, timestamp and duplicate-handling tests for #46.

Covers the path a FIRMS file takes before it is stored:
    raw CSV row -> firms_cleaning (timestamp, duplicates) -> load_firms_to_db
    -> public.detections (unique constraint) -> validate_detections
"""
import os
from datetime import datetime, timezone

import pytest

from firms_cleaning import clean_rows, parse_timestamp
from load_firms_to_db import INSERT_SQL, build_rows, insert_detections
from validate_detections import CHECKS, ERROR, WARNING, format_report, has_errors, run_checks

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def raw(**overrides):
    row = {
        "latitude": "56.72", "longitude": "-111.38", "acq_date": "2023-06-04",
        "acq_time": "1745", "confidence": "82", "satellite": "Terra",
        "instrument": "MODIS", "frp": "35.1", "daynight": "D", "type": "0",
    }
    row.update(overrides)
    return row


def as_csv_row(cleaned):
    """What the loader reads back from the cleaned CSV: every value is text."""
    return {k: "" if v is None else str(v) for k, v in cleaned.items()}


# --- Timestamps ---------------------------------------------------------------

@pytest.mark.parametrize("acq_time, expected", [
    ("0", "2023-06-04T00:00:00Z"),      # midnight, stored without zeros
    ("5", "2023-06-04T00:05:00Z"),
    ("45", "2023-06-04T00:45:00Z"),
    ("130", "2023-06-04T01:30:00Z"),
    ("2359", "2023-06-04T23:59:00Z"),   # last minute of the day
    (" 1745 ", "2023-06-04T17:45:00Z"),  # spaces from the CSV
])
def test_acq_time_becomes_utc_minute(acq_time, expected):
    assert parse_timestamp("2023-06-04", acq_time) == expected


@pytest.mark.parametrize("acq_time", ["2400", "0060", "12345", "17:45", "-5", "", "abc"])
def test_impossible_times_are_rejected(acq_time):
    with pytest.raises(ValueError):
        parse_timestamp("2023-06-04", acq_time)


def test_leap_day_is_accepted_only_in_leap_years():
    assert parse_timestamp("2024-02-29", "1200") == "2024-02-29T12:00:00Z"
    with pytest.raises(ValueError):
        parse_timestamp("2023-02-29", "1200")


def test_timestamp_is_utc_and_has_no_seconds():
    moment = datetime.fromisoformat(parse_timestamp("2025-12-31", "2207").replace("Z", "+00:00"))
    assert moment.utcoffset() == timezone.utc.utcoffset(None)
    assert moment.second == 0 and moment.microsecond == 0


def test_bad_timestamps_are_dropped_and_counted():
    cleaned, report = clean_rows([raw(), raw(acq_time="2400"), raw(acq_date="2023-13-01")])
    assert len(cleaned) == 1
    assert report["drop_reasons"] == {"invalid timestamp": 2}


# --- Duplicates ---------------------------------------------------------------

def test_overlapping_downloads_keep_one_copy():
    first_file = [raw(acq_time="1745"), raw(acq_time="1750")]
    second_file = [raw(acq_time="1750"), raw(acq_time="1755")]  # overlaps by one row
    cleaned, report = clean_rows(first_file + second_file)
    assert [c["timestamp"][11:16] for c in cleaned] == ["17:45", "17:50", "17:55"]
    assert report["duplicate_rows"] == 1


def test_same_detection_written_differently_is_still_a_duplicate():
    cleaned, report = clean_rows([
        raw(latitude="56.72", acq_time="5"),
        raw(latitude="56.720", acq_time="0005"),
    ])
    assert len(cleaned) == 1
    assert report["duplicate_rows"] == 1


def test_same_place_and_time_from_another_satellite_is_kept():
    cleaned, report = clean_rows([raw(satellite="Terra"), raw(satellite="Aqua")])
    assert {c["satellite"] for c in cleaned} == {"Terra", "Aqua"}
    assert report["duplicate_rows"] == 0


def test_duplicates_without_satellite_are_removed():
    cleaned, report = clean_rows([raw(satellite=""), raw(satellite="")])
    assert len(cleaned) == 1
    assert cleaned[0]["satellite"] is None
    assert report["duplicate_rows"] == 1


def test_duplicate_is_counted_separately_from_bad_rows():
    _, report = clean_rows([raw(), raw(), raw(latitude="95")])
    assert report == {
        "total_rows": 3, "kept_rows": 1, "dropped_rows": 1,
        "duplicate_rows": 1, "drop_reasons": {"invalid coordinates": 1},
    }


# --- Loading into the database ------------------------------------------------

class FakeTable:
    """Stands in for public.detections with its unique constraint."""

    def __init__(self):
        self.keys = set()

    def insert(self, row):
        key = (row[0], row[1], row[2], row[6])  # latitude, longitude, detected_at, satellite
        if key in self.keys:
            return 0  # on conflict do nothing
        self.keys.add(key)
        return 1


class FakeCursor:
    def __init__(self, table):
        self.table, self.rowcount, self.sql = table, 0, []

    def executemany(self, sql, batch):
        self.sql.append(sql)
        self.rowcount = sum(self.table.insert(row) for row in batch)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeConnection:
    def __init__(self, table):
        self.cur, self.commits = FakeCursor(table), 0

    def cursor(self):
        return self.cur

    def commit(self):
        self.commits += 1


def cleaned_csv_rows(rows):
    cleaned, _ = clean_rows(rows)
    return [as_csv_row(c) for c in cleaned]


def test_loading_the_same_file_twice_adds_nothing_new():
    table = FakeTable()
    rows = build_rows(cleaned_csv_rows([raw(acq_time=t) for t in ("1745", "1750", "1755")]))

    assert insert_detections(FakeConnection(table), rows) == 3
    assert insert_detections(FakeConnection(table), rows) == 0
    assert len(table.keys) == 3


def test_loading_an_overlapping_file_only_adds_the_new_rows():
    table = FakeTable()
    insert_detections(FakeConnection(table), build_rows(cleaned_csv_rows([raw(acq_time="1745"), raw(acq_time="1750")])))
    newer = build_rows(cleaned_csv_rows([raw(acq_time="1750"), raw(acq_time="1755")]))
    assert insert_detections(FakeConnection(table), newer, batch_size=1) == 1


def test_loader_relies_on_the_unique_constraint():
    assert "on conflict on constraint detections_unique do nothing" in INSERT_SQL


def test_timestamp_reaches_the_database_unchanged():
    (row,) = build_rows(cleaned_csv_rows([raw(acq_date="2023-01-02", acq_time="5")]))
    assert row[2] == "2023-01-02T00:05:00Z"


def test_unique_constraint_treats_missing_satellite_as_one_value():
    path = os.path.join(ROOT, "supabase", "migrations", "20261031000000_detections_unique_nulls.sql")
    with open(path, encoding="utf-8") as f:
        sql = " ".join(f.read().lower().split())
    assert "add constraint detections_unique unique nulls not distinct (latitude, longitude, detected_at, satellite)" in sql


# --- Validating what is stored ------------------------------------------------

SUMMARY = (627863, "2023-01-02 19:15:00+00", "2025-12-31 22:07:00+00", 2,
           "2026-10-14 00:20:52+00", "2026-10-14 00:25:38+00")


class ValidationCursor:
    def __init__(self, counts, summary=SUMMARY):
        self.counts, self.summary, self.executed = counts, summary, []

    def execute(self, sql):
        self.executed.append(sql)
        self.result = self.summary if "min(created_at)" in sql else (self.counts.get(sql, 0),)

    def fetchone(self):
        return self.result

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class ValidationConnection:
    def __init__(self, cur):
        self.cur = cur

    def cursor(self):
        return self.cur


def check(name):
    return next(c for c in CHECKS if c["name"] == name)


def test_clean_table_passes_every_check():
    cur = ValidationCursor({})
    summary, results = run_checks(ValidationConnection(cur))

    assert summary["total"] == 627863
    assert all(r["passed"] for r in results)
    assert len(cur.executed) == len(CHECKS) + 1
    assert not has_errors(results)


def test_duplicates_or_future_times_are_errors():
    cur = ValidationCursor({
        check("duplicate detections")["sql"]: 3,
        check("detections in the future")["sql"]: 1,
    })
    _, results = run_checks(ValidationConnection(cur))

    failed = {r["name"]: r["count"] for r in results if not r["passed"]}
    assert failed == {"duplicate detections": 3, "detections in the future": 1}
    assert has_errors(results)


def test_warnings_alone_do_not_fail_the_run():
    cur = ValidationCursor({check("non-wildfire detections")["sql"]: 682})
    summary, results = run_checks(ValidationConnection(cur))

    assert not has_errors(results)
    report = format_report(summary, results)
    assert "[WARN] non-wildfire detections: 682" in report
    assert "0 error(s), 1 warning(s)" in report


def test_empty_table_is_an_error_not_a_pass():
    cur = ValidationCursor({}, summary=(0, None, None, 0, None, None))
    _, results = run_checks(ValidationConnection(cur))

    assert has_errors(results)
    assert len(cur.executed) == 1  # no point running the other checks


def test_duplicate_check_matches_the_unique_constraint():
    sql = " ".join(check("duplicate detections")["sql"].split())
    assert "group by latitude, longitude, detected_at, coalesce(satellite, '')" in sql


def test_every_check_is_read_only():
    for c in CHECKS:
        words = c["sql"].lower().split()
        assert not {"insert", "update", "delete", "drop", "alter", "truncate"} & set(words), c["name"]
        assert c["level"] in (ERROR, WARNING)
