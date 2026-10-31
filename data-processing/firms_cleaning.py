"""Clean NASA FIRMS active-fire CSVs for model input.

FIRMS publishes detections from two instrument families with slightly
different columns:

* MODIS: ``confidence`` is a number from 0 to 100.
* VIIRS: ``confidence`` is a letter: ``l`` (low), ``n`` (nominal), ``h`` (high).

This module turns either format into one consistent table:

    latitude, longitude, timestamp, confidence, confidence_class,
    instrument, satellite, frp, daynight, type

Rows with unusable data (missing or out-of-range coordinates, bad
dates, unreadable confidence) are dropped rather than guessed, in line
with issue #27 ("clearly identify unavailable values instead of
fabricating them"). The number of dropped rows and the reasons are
returned so they can be reported.

Usage (from the repository root):

    python data-processing/firms_cleaning.py raw_firms.csv cleaned_firms.csv
"""

import csv
import math
import sys
from collections import Counter
from datetime import datetime, timezone

# FIRMS confidence classes for MODIS (0-100), from the FIRMS FAQ:
# 0-29 low, 30-79 nominal, 80-100 high.
MODIS_LOW_MAX = 29
MODIS_NOMINAL_MAX = 79

# VIIRS only reports a class, not a number. To put both instruments on
# one 0-100 scale, each VIIRS class is mapped to the middle of the
# matching MODIS range. This is an assumption and is documented so it
# can be revisited.
VIIRS_CLASS_TO_SCORE = {"l": 15, "n": 55, "h": 90}
VIIRS_CLASS_NAMES = {"l": "low", "n": "nominal", "h": "high"}

OUTPUT_COLUMNS = [
    "latitude",
    "longitude",
    "timestamp",
    "confidence",
    "confidence_class",
    "instrument",
    "satellite",
    "frp",
    "daynight",
    "type",
]


def classify_modis_confidence(score):
    """Return the FIRMS confidence class for a 0-100 MODIS score."""
    if score <= MODIS_LOW_MAX:
        return "low"
    if score <= MODIS_NOMINAL_MAX:
        return "nominal"
    return "high"


def parse_confidence(raw):
    """Return (score 0-100, class name) or raise ValueError.

    Accepts MODIS numbers ("0"-"100") and VIIRS letters ("l", "n", "h").
    """
    if raw is None:
        raise ValueError("missing confidence")
    value = str(raw).strip().lower()
    if value in VIIRS_CLASS_TO_SCORE:
        return VIIRS_CLASS_TO_SCORE[value], VIIRS_CLASS_NAMES[value]
    score = float(value)  # raises ValueError for anything non-numeric
    if not math.isfinite(score) or not 0 <= score <= 100:
        raise ValueError("confidence out of range")
    return score, classify_modis_confidence(score)


def parse_timestamp(acq_date, acq_time):
    """Combine FIRMS acq_date (YYYY-MM-DD) and acq_time (HHMM, UTC).

    acq_time is often stored without leading zeros (e.g. "5" for 00:05),
    so it is zero-padded to four digits first.
    """
    time_str = str(acq_time).strip()
    if not time_str.isdigit() or len(time_str) > 4:
        raise ValueError("invalid acq_time")
    time_str = time_str.zfill(4)
    moment = datetime.strptime(f"{acq_date.strip()} {time_str}", "%Y-%m-%d %H%M")
    return moment.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def parse_coordinate(raw, low, high):
    value = float(raw)
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError("coordinate out of range")
    return value


def optional_float(raw):
    """Return a float, or None when the value is missing (never a made-up 0)."""
    if raw is None or str(raw).strip() == "":
        return None
    value = float(raw)
    if not math.isfinite(value) or value < 0:
        raise ValueError("invalid fire radiative power")
    return value


def clean_row(row):
    """Return a cleaned row dict, or raise ValueError with the reason."""
    try:
        latitude = parse_coordinate(row.get("latitude"), -90, 90)
        longitude = parse_coordinate(row.get("longitude"), -180, 180)
    except (TypeError, ValueError):
        raise ValueError("invalid coordinates")

    try:
        timestamp = parse_timestamp(row.get("acq_date", ""), row.get("acq_time", ""))
    except (TypeError, ValueError, AttributeError):
        raise ValueError("invalid timestamp")

    try:
        confidence, confidence_class = parse_confidence(row.get("confidence"))
    except (TypeError, ValueError):
        raise ValueError("invalid confidence")

    try:
        frp = optional_float(row.get("frp"))
    except ValueError:
        frp = None

    fire_type = row.get("type")
    fire_type = fire_type.strip() if fire_type and fire_type.strip() else None

    return {
        "latitude": latitude,
        "longitude": longitude,
        "timestamp": timestamp,
        "confidence": confidence,
        "confidence_class": confidence_class,
        "instrument": (row.get("instrument") or "").strip() or None,
        "satellite": (row.get("satellite") or "").strip() or None,
        "frp": frp,
        "daynight": (row.get("daynight") or "").strip() or None,
        "type": fire_type,
    }


def clean_rows(rows):
    """Clean an iterable of raw FIRMS rows.

    Returns (cleaned_rows, report) where report counts kept, dropped and
    duplicate rows, plus the reasons rows were dropped.
    """
    cleaned = []
    seen = set()
    reasons = Counter()
    duplicates = 0
    total = 0

    for row in rows:
        total += 1
        try:
            item = clean_row(row)
        except ValueError as error:
            reasons[str(error)] += 1
            continue

        # The same detection can appear twice when files overlap.
        key = (item["latitude"], item["longitude"], item["timestamp"], item["satellite"])
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        cleaned.append(item)

    report = {
        "total_rows": total,
        "kept_rows": len(cleaned),
        "dropped_rows": sum(reasons.values()),
        "duplicate_rows": duplicates,
        "drop_reasons": dict(reasons),
    }
    return cleaned, report


def clean_file(input_path, output_path):
    """Clean a raw FIRMS CSV file and write the result. Returns the report."""
    with open(input_path, newline="", encoding="utf-8") as source:
        cleaned, report = clean_rows(csv.DictReader(source))

    with open(output_path, "w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        for item in cleaned:
            writer.writerow({key: "" if value is None else value for key, value in item.items()})

    return report


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python data-processing/firms_cleaning.py <raw.csv> <cleaned.csv>")
        sys.exit(1)
    summary = clean_file(sys.argv[1], sys.argv[2])
    print(
        f"Kept {summary['kept_rows']} of {summary['total_rows']} rows "
        f"({summary['dropped_rows']} dropped, {summary['duplicate_rows']} duplicates)."
    )
    for reason, count in summary["drop_reasons"].items():
        print(f"  dropped {count}: {reason}")
