import csv

import pytest

from firms_cleaning import clean_file, clean_rows, parse_confidence, parse_timestamp

MODIS_ROW = {
    "latitude": "45.83", "longitude": "-78.37", "acq_date": "2023-06-04", "acq_time": "1745",
    "satellite": "Terra", "instrument": "MODIS", "confidence": "82", "frp": "15.2",
    "daynight": "D", "type": "0",
}
VIIRS_ROW = {
    "latitude": "49.10", "longitude": "-122.55", "acq_date": "2023-06-04", "acq_time": "5",
    "satellite": "N", "instrument": "VIIRS", "confidence": "n", "frp": "",
    "daynight": "N", "type": "2",
}


@pytest.mark.parametrize("raw, expected", [
    ("0", (0.0, "low")), ("29", (29.0, "low")), ("30", (30.0, "nominal")),
    ("79", (79.0, "nominal")), ("80", (80.0, "high")), ("100", (100.0, "high")),
    ("l", (15, "low")), ("N", (55, "nominal")), ("h", (90, "high")),
])
def test_parse_confidence(raw, expected):
    assert parse_confidence(raw) == expected


@pytest.mark.parametrize("raw", ["", "x", "101", "-5", None])
def test_parse_confidence_rejects_bad_values(raw):
    with pytest.raises(ValueError):
        parse_confidence(raw)


def test_timestamp_pads_short_times():
    assert parse_timestamp("2023-06-04", "5") == "2023-06-04T00:05:00Z"
    assert parse_timestamp("2023-06-04", "1745") == "2023-06-04T17:45:00Z"


def test_clean_rows_keeps_valid_modis_and_viirs():
    cleaned, report = clean_rows([MODIS_ROW, VIIRS_ROW])
    assert report["kept_rows"] == 2
    assert cleaned[0]["confidence_class"] == "high"
    assert cleaned[1]["confidence"] == 55
    assert cleaned[1]["frp"] is None  # missing value stays missing, not 0


def test_clean_rows_drops_bad_rows_with_reasons():
    bad = [
        {**MODIS_ROW, "latitude": "95"},
        {**MODIS_ROW, "acq_date": "not-a-date"},
        {**MODIS_ROW, "confidence": "?"},
    ]
    cleaned, report = clean_rows(bad)
    assert cleaned == []
    assert report["drop_reasons"] == {
        "invalid coordinates": 1, "invalid timestamp": 1, "invalid confidence": 1,
    }


def test_clean_rows_removes_duplicates():
    cleaned, report = clean_rows([MODIS_ROW, dict(MODIS_ROW)])
    assert report["kept_rows"] == 1
    assert report["duplicate_rows"] == 1


def test_clean_file_round_trip(tmp_path):
    raw = tmp_path / "raw.csv"
    with open(raw, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(MODIS_ROW.keys()))
        writer.writeheader()
        writer.writerows([MODIS_ROW, VIIRS_ROW, {**MODIS_ROW, "longitude": "abc"}])

    out = tmp_path / "clean.csv"
    report = clean_file(raw, out)

    assert report["kept_rows"] == 2
    with open(out, newline="") as f:
        rows = list(csv.DictReader(f))
    assert rows[0]["timestamp"] == "2023-06-04T17:45:00Z"

def test_nonfinite_coordinates_and_confidence_are_rejected():
    for coordinate in ("nan", "inf", "-inf"):
        cleaned, report = clean_rows([{**MODIS_ROW, "latitude": coordinate}])
        assert cleaned == []
        assert report["drop_reasons"] == {"invalid coordinates": 1}

    for confidence in ("nan", "inf", "-inf"):
        cleaned, report = clean_rows([{**MODIS_ROW, "confidence": confidence}])
        assert cleaned == []
        assert report["drop_reasons"] == {"invalid confidence": 1}


def test_nonfinite_or_negative_frp_stays_unavailable():
    for frp in ("nan", "inf", "-inf", "-1"):
        cleaned, report = clean_rows([{**MODIS_ROW, "frp": frp}])
        assert report["kept_rows"] == 1
        assert cleaned[0]["frp"] is None
