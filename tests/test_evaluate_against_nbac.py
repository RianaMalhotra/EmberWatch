"""Tests for the burned-area (NBAC) check (#56) that need no map libraries.

The tests that do are in test_evaluate_against_nbac_maps.py and are skipped
when geopandas, shapely and pyproj (ml/requirements-nbac.txt) are not installed.
"""

import csv

import pytest

import evaluate_against_nbac as nbac

CLEANED_COLUMNS = ["latitude", "longitude", "timestamp", "confidence"]


def write_cleaned(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as target:
        writer = csv.writer(target)
        writer.writerow(CLEANED_COLUMNS)
        writer.writerows(rows)


# -- reading detections (no map libraries needed) ---------------------------

def test_load_detections_keeps_one_year_and_counts_unusable_rows(tmp_path):
    path = tmp_path / "cleaned.csv"
    write_cleaned(path, [
        (51.0, -100.0, "2023-06-04T00:05:00Z", 80),
        (52.0, -101.0, "2024-06-04T00:05:00Z", 70),   # another year: ignored, not an error
        (53.0, -102.0, "2023-07-01T10:00:00Z", 55),
        ("bad", -102.0, "2023-07-01T10:00:00Z", 55),  # unusable
        (95.0, -102.0, "2023-07-01T10:00:00Z", 55),   # impossible latitude
        (53.0, -102.0, "", 55),                       # no timestamp
    ])
    lats, lons, confidences, skipped = nbac.load_detections(str(path), 2023)
    assert lats == [51.0, 53.0] and lons == [-100.0, -102.0] and confidences == [80.0, 55.0]
    assert skipped == 3


def test_load_detections_accepts_a_database_export_with_detected_at(tmp_path):
    path = tmp_path / "export.csv"
    with open(path, "w", newline="", encoding="utf-8") as target:
        writer = csv.writer(target)
        writer.writerow(["latitude", "longitude", "detected_at", "confidence"])
        writer.writerow([51.0, -100.0, "2023-06-04 00:05:00+00", 80])
    assert nbac.load_detections(str(path), 2023)[2] == [80.0]


def test_missing_libraries_give_a_helpful_message(monkeypatch):
    import builtins
    real_import = builtins.__import__

    def blocked(name, *args, **kwargs):
        if name in ("geopandas", "shapely", "pyproj"):
            raise ImportError(f"No module named {name!r}")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", blocked)
    with pytest.raises(ImportError, match="requirements-nbac.txt"):
        nbac.load_burned_areas("anything.shp")
