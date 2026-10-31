"""Fetch recent NASA FIRMS fire detections and store them in Supabase.

The 2023-2025 archive was loaded once (see docs/detection-data-provenance.md).
This script keeps the map current with the near-real-time (NRT) feed, which
FIRMS publishes within about 3 hours of each satellite pass. It reuses the same
cleaning (firms_cleaning.py) and loading (load_firms_to_db.py) as the archive,
so timestamps, confidence and duplicate handling are identical.

Run from the repository root:

    python data-processing/fetch_firms_nrt.py --dry-run     # fetch and print, write nothing
    python data-processing/fetch_firms_nrt.py               # last 2 days, MODIS, Canada
    python data-processing/fetch_firms_nrt.py --days 10     # catch up after a gap

Needs a free FIRMS map key (https://firms.modaps.eosdis.nasa.gov/api/map_key/)
in FIRMS_MAP_KEY, and DATABASE_URL for writing. Both are read from the
environment or backend/.env. Re-running is safe: rows already stored are
skipped by the detections_unique constraint.
"""

import argparse
import csv
import io
import os
import sys
import urllib.error
import urllib.request

from firms_cleaning import clean_rows
from load_firms_to_db import build_rows, insert_detections

HERE = os.path.dirname(os.path.abspath(__file__))
# The country endpoint clips to Canada's border. A bounding box around
# Canada also covers the northern US (it returned fires in Montana and
# Oregon), which the archive download did not include.
COUNTRY_URL = "https://firms.modaps.eosdis.nasa.gov/api/country/csv/{key}/{source}/{country}/{days}"
AREA_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{area}/{days}"
DEFAULT_COUNTRY = "CAN"

# MODIS matches the archive already stored and the confidence threshold
# backtest (#19), which used MODIS 0-100 confidence.
DEFAULT_SOURCE = "MODIS_NRT"
SOURCES = ("MODIS_NRT", "VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT")


MAX_DAYS = 10  # FIRMS allows 1-10 days per request
TIMEOUT_SECONDS = 60

# FIRMS uses short satellite codes in some feeds. Store full names so the same
# pass from different feeds matches in the duplicate check.
SATELLITE_NAMES = {
    "T": "Terra",
    "A": "Aqua",
    "N": "Suomi NPP",
    "N20": "NOAA-20",
    "1": "NOAA-20",
    "N21": "NOAA-21",
    "2": "NOAA-21",
}


class FirmsError(RuntimeError):
    """FIRMS answered, but not with detection data (bad key, limit reached, ...)."""


def build_url(key, source=DEFAULT_SOURCE, area=None, days=2, country=DEFAULT_COUNTRY):
    """Country query by default; a west,south,east,north box if `area` is given."""
    if source not in SOURCES:
        raise ValueError(f"source must be one of {', '.join(SOURCES)}")
    if not 1 <= days <= MAX_DAYS:
        raise ValueError(f"days must be between 1 and {MAX_DAYS}")
    if area:
        return AREA_URL.format(key=key, source=source, area=area, days=days)
    return COUNTRY_URL.format(key=key, source=source, country=country, days=days)


def parse_csv(text):
    """Return FIRMS rows as dicts, or raise FirmsError if it is not a FIRMS CSV.

    On a bad key or exhausted quota FIRMS replies with a short text message
    instead of a CSV, sometimes with HTTP 200, so the header is checked.
    """
    text = text.lstrip("﻿").strip()
    first_line = text.splitlines()[0] if text else ""
    columns = {c.strip().lower() for c in first_line.split(",")}
    if not {"latitude", "longitude", "acq_date", "acq_time", "confidence"} <= columns:
        raise FirmsError(f"FIRMS did not return detection data: {first_line[:200] or '(empty reply)'}")
    return list(csv.DictReader(io.StringIO(text)))


def normalize_satellite(rows):
    for row in rows:
        code = (row.get("satellite") or "").strip()
        row["satellite"] = SATELLITE_NAMES.get(code.upper(), code)
    return rows


def fetch_text(url, opener=urllib.request.urlopen):
    try:
        with opener(url, timeout=TIMEOUT_SECONDS) as response:
            return response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")[:200]
        raise FirmsError(f"FIRMS returned HTTP {error.code}: {body}") from error


def fetch_detections(key, source=DEFAULT_SOURCE, area=None, days=2, opener=urllib.request.urlopen):
    """Fetch and clean. Returns (cleaned rows, cleaning report)."""
    rows = normalize_satellite(parse_csv(fetch_text(build_url(key, source, area, days), opener)))
    return clean_rows(rows)


def store(conn, cleaned, source=DEFAULT_SOURCE):
    """Insert cleaned rows. Returns how many were new."""
    return insert_detections(conn, build_rows(cleaned, source=f"NASA FIRMS {source}"))


def parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--days", type=int, default=2,
                        help=f"days to fetch, ending today (1-{MAX_DAYS}, default 2)")
    parser.add_argument("--source", default=DEFAULT_SOURCE, choices=SOURCES,
                        help=f"FIRMS NRT product (default {DEFAULT_SOURCE})")
    parser.add_argument("--area", default=None,
                        help="west,south,east,north box instead of Canada's border (optional)")
    parser.add_argument("--dry-run", action="store_true", help="fetch and print; no database")
    args = parser.parse_args(argv)
    if not 1 <= args.days <= MAX_DAYS:
        parser.error(f"--days must be between 1 and {MAX_DAYS}")
    return args


def format_report(report):
    text = (f"FIRMS rows: {report['total_rows']}, usable: {report['kept_rows']}, "
            f"dropped: {report['dropped_rows']}, duplicates in feed: {report['duplicate_rows']}")
    if report["drop_reasons"]:
        reasons = ", ".join(f"{k}: {v}" for k, v in sorted(report["drop_reasons"].items()))
        text += f" ({reasons})"
    return text


def main(argv=None):
    args = parse_args(argv)
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(HERE, "..", "backend", ".env"))
    except ImportError:
        pass  # fine when the variables are set in the environment (CI)

    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not key:
        sys.exit("FIRMS_MAP_KEY is not set. Get a free key at "
                 "https://firms.modaps.eosdis.nasa.gov/api/map_key/ and add it to backend/.env.")

    try:
        cleaned, report = fetch_detections(key, args.source, args.area, args.days)
    except FirmsError as error:
        sys.exit(str(error).replace(key, "***"))
    except OSError as error:  # URLError, timeouts
        sys.exit(f"Could not reach FIRMS ({error}). Nothing was written; try again later.".replace(key, "***"))

    print(format_report(report))
    if args.dry_run:
        for row in cleaned[:10]:
            print(f"  {row['timestamp']} {row['satellite']} ({row['latitude']}, {row['longitude']}) "
                  f"confidence {row['confidence']:.0f} {row['confidence_class']}")
        print(f"Dry run: {len(cleaned)} detections would be stored. Nothing written.")
        return

    import psycopg

    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set. Fill in backend/.env first (see backend/.env.example).")
    with psycopg.connect(url) as conn:
        inserted = store(conn, cleaned, args.source)
    print(f"Inserted {inserted} new detections ({len(cleaned) - inserted} already in the database).")


if __name__ == "__main__":
    main()
