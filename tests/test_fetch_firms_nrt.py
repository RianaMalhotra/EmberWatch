"""Tests for the near-real-time FIRMS feed (fetch_firms_nrt.py). No network or database."""
import io
import urllib.error

import pytest

import fetch_firms_nrt as nrt
from load_firms_to_db import INSERT_SQL

MODIS_CSV = """latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight
56.7213,-111.3801,330.5,1.1,1.0,2026-10-30,1905,Terra,MODIS,82,6.1NRT,290.1,35.2,D
56.7213,-111.3801,330.5,1.1,1.0,2026-10-30,1905,Terra,MODIS,82,6.1NRT,290.1,35.2,D
49.8880,-119.4960,310.2,1.0,1.0,2026-10-31,512,A,MODIS,40,6.1NRT,280.0,,N
95.0000,-119.4960,310.2,1.0,1.0,2026-10-31,512,Aqua,MODIS,40,6.1NRT,280.0,4.0,N
"""

VIIRS_CSV = """latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
58.1000,-117.2000,340.1,0.4,0.4,2026-10-31,2010,N20,VIIRS,h,2.0NRT,290.0,12.5,D
58.1010,-117.2010,320.1,0.4,0.4,2026-10-31,2010,N,VIIRS,n,2.0NRT,285.0,3.1,D
"""


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def opener_returning(text, calls=None):
    def opener(url, timeout):
        if calls is not None:
            calls.append((url, timeout))
        return FakeResponse(text.encode("utf-8"))
    return opener


# --- request ------------------------------------------------------------------

def test_default_query_is_clipped_to_canada():
    url = nrt.build_url("KEY123", "MODIS_NRT", days=2)
    assert url == "https://firms.modaps.eosdis.nasa.gov/api/country/csv/KEY123/MODIS_NRT/CAN/2"


def test_a_box_can_be_used_instead():
    url = nrt.build_url("KEY123", "MODIS_NRT", "-125,48,-114,60", 2)
    assert url == "https://firms.modaps.eosdis.nasa.gov/api/area/csv/KEY123/MODIS_NRT/-125,48,-114,60/2"


@pytest.mark.parametrize("days", [0, 11, -1])
def test_day_range_is_limited_to_what_firms_allows(days):
    with pytest.raises(ValueError):
        nrt.build_url("KEY", days=days)


def test_unknown_product_is_rejected():
    with pytest.raises(ValueError):
        nrt.build_url("KEY", source="MODIS_SP")  # archive product, not NRT


# --- reply --------------------------------------------------------------------

def test_modis_feed_is_cleaned_like_the_archive():
    calls = []
    cleaned, report = nrt.fetch_detections("KEY", opener=opener_returning(MODIS_CSV, calls))

    assert calls[0][1] == nrt.TIMEOUT_SECONDS
    assert report["total_rows"] == 4
    assert report["duplicate_rows"] == 1
    assert report["drop_reasons"] == {"invalid coordinates": 1}
    first, second = cleaned
    assert first["timestamp"] == "2026-10-30T19:05:00Z"
    assert first["confidence_class"] == "high"
    assert second["timestamp"] == "2026-10-31T05:12:00Z"  # "512" padded to 05:12
    assert second["satellite"] == "Aqua"                  # "A" expanded
    assert second["frp"] is None                           # missing, not 0


def test_viirs_letters_and_satellite_codes_are_understood():
    cleaned, _ = nrt.fetch_detections("KEY", source="VIIRS_NOAA20_NRT", opener=opener_returning(VIIRS_CSV))
    assert [(c["satellite"], c["confidence_class"]) for c in cleaned] == [("NOAA-20", "high"), ("Suomi NPP", "nominal")]


def test_no_fires_is_not_an_error():
    header_only = MODIS_CSV.splitlines()[0] + "\n"
    cleaned, report = nrt.fetch_detections("KEY", opener=opener_returning(header_only))
    assert cleaned == [] and report["total_rows"] == 0


@pytest.mark.parametrize("reply", ["Invalid MAP_KEY.", "Exceeding allowed transaction limit.", "", "<html>error</html>"])
def test_text_reply_instead_of_csv_is_an_error(reply):
    with pytest.raises(nrt.FirmsError, match="did not return detection data"):
        nrt.fetch_detections("KEY", opener=opener_returning(reply))


def test_http_error_is_reported_with_its_message():
    def opener(url, timeout):
        raise urllib.error.HTTPError(url, 400, "Bad Request", {}, io.BytesIO(b"Invalid area coordinates"))
    with pytest.raises(nrt.FirmsError, match="HTTP 400: Invalid area coordinates"):
        nrt.fetch_detections("KEY", opener=opener)


def test_country_reply_with_extra_column_is_read():
    country_csv = "country_id," + MODIS_CSV.splitlines()[0] + "\n" + "\n".join(
        "CAN," + line for line in MODIS_CSV.splitlines()[1:]) + "\n"
    cleaned, report = nrt.fetch_detections("KEY", opener=opener_returning(country_csv))
    assert report["kept_rows"] == 2 and len(cleaned) == 2


def test_byte_order_mark_is_ignored():
    cleaned, _ = nrt.fetch_detections("KEY", opener=opener_returning("﻿" + VIIRS_CSV))
    assert len(cleaned) == 2


# --- storing ------------------------------------------------------------------

class FakeTable:
    def __init__(self):
        self.rows = {}

    def insert(self, row):
        key = (row[0], row[1], row[2], row[6])
        if key in self.rows:
            return 0
        self.rows[key] = row
        return 1


class FakeCursor:
    def __init__(self, table):
        self.table, self.rowcount = table, 0

    def executemany(self, sql, batch):
        assert sql == INSERT_SQL
        self.rowcount = sum(self.table.insert(r) for r in batch)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeConnection:
    def __init__(self, table):
        self.table = table

    def cursor(self):
        return FakeCursor(self.table)

    def commit(self):
        pass


def test_running_every_few_hours_only_adds_new_detections():
    table = FakeTable()
    first, _ = nrt.fetch_detections("KEY", opener=opener_returning(MODIS_CSV))
    assert nrt.store(FakeConnection(table), first) == 2

    # Next run: overlapping window with one new pass.
    newer = MODIS_CSV + "60.1000,-115.2000,330.0,1.0,1.0,2026-10-31,1830,Terra,MODIS,90,6.1NRT,290.0,20.0,D\n"
    again, _ = nrt.fetch_detections("KEY", opener=opener_returning(newer))
    assert nrt.store(FakeConnection(table), again) == 1
    assert len(table.rows) == 3


def test_rows_record_which_feed_they_came_from():
    table = FakeTable()
    cleaned, _ = nrt.fetch_detections("KEY", source="VIIRS_SNPP_NRT", opener=opener_returning(VIIRS_CSV))
    nrt.store(FakeConnection(table), cleaned, "VIIRS_SNPP_NRT")
    assert {row[10] for row in table.rows.values()} == {"NASA FIRMS VIIRS_SNPP_NRT"}


# --- command line -------------------------------------------------------------

def test_missing_key_stops_with_a_clear_message(monkeypatch):
    monkeypatch.setenv("FIRMS_MAP_KEY", "")
    monkeypatch.setattr(nrt, "HERE", "/nonexistent")  # don't read a real backend/.env
    with pytest.raises(SystemExit, match="FIRMS_MAP_KEY is not set"):
        nrt.main(["--dry-run"])


def test_key_is_never_printed_in_errors(monkeypatch):
    monkeypatch.setenv("FIRMS_MAP_KEY", "SECRETKEY")
    monkeypatch.setattr(nrt, "HERE", "/nonexistent")

    def failing(*args, **kwargs):
        raise nrt.FirmsError("FIRMS did not return detection data: bad key SECRETKEY")
    monkeypatch.setattr(nrt, "fetch_detections", failing)

    with pytest.raises(SystemExit) as stop:
        nrt.main(["--dry-run"])
    assert "SECRETKEY" not in str(stop.value)


def test_dry_run_writes_nothing(monkeypatch, capsys):
    monkeypatch.setenv("FIRMS_MAP_KEY", "KEY")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(nrt, "HERE", "/nonexistent")
    monkeypatch.setattr(nrt, "fetch_detections",
                        lambda *a, **k: nrt.clean_rows(nrt.normalize_satellite(nrt.parse_csv(MODIS_CSV))))
    nrt.main(["--dry-run"])
    out = capsys.readouterr().out
    assert "usable: 2" in out and "Nothing written" in out


@pytest.mark.parametrize("days", ["0", "11"])
def test_command_line_rejects_bad_day_range(days):
    with pytest.raises(SystemExit):
        nrt.parse_args(["--days", days])
