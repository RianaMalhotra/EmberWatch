"""Export stored FIRMS archive detections from Supabase to one CSV per year (#56).

Read-only: it runs SELECT queries and writes files, it never changes data.
The raw and cleaned FIRMS files are not in git, but the same detections are in
`public.detections`, so this recreates the input that
`ml/evaluate_against_nbac.py` needs without downloading from NASA again.

    python data-processing/export_detections.py 2023 2024 2025

Writes data-processing/data/detections_<year>.csv (git-ignored) with the
columns latitude, longitude, timestamp (UTC, ISO 8601) and confidence.
Only archive rows (source "NASA FIRMS") are exported, not near-real-time ones.

The database URL is read from DATABASE_URL (backend/.env is loaded
automatically). Years follow UTC, like the cleaned files.
"""

import csv
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "data")
ARCHIVE_SOURCE = "NASA FIRMS"  # same value load_firms_to_db.py stores for archive rows
COLUMNS = ["latitude", "longitude", "timestamp", "confidence"]

EXPORT_SQL = """
    select latitude,
           longitude,
           to_char(detected_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as timestamp,
           confidence
    from public.detections
    where source = %s
      and detected_at >= %s::timestamptz
      and detected_at <  %s::timestamptz
    order by detected_at, latitude, longitude
"""


def year_bounds(year):
    """UTC start (inclusive) and end (exclusive) of a calendar year."""
    return f"{year}-01-01T00:00:00Z", f"{year + 1}-01-01T00:00:00Z"


def export_year(conn, year, path):
    """Write one year of archive detections to ``path``. Returns the row count."""
    start, end = year_bounds(year)
    count = 0
    with open(path, "w", newline="", encoding="utf-8") as target:
        writer = csv.writer(target, lineterminator="\n")
        writer.writerow(COLUMNS)
        # A named cursor streams rows instead of loading ~300,000 into memory.
        with conn.cursor(name=f"export_{year}") as cur:
            cur.execute(EXPORT_SQL, (ARCHIVE_SOURCE, start, end))
            for latitude, longitude, timestamp, confidence in cur:
                writer.writerow([latitude, longitude, timestamp, confidence])
                count += 1
    return count


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    out_dir = DATA_DIR
    if "--out-dir" in args:
        i = args.index("--out-dir")
        try:
            out_dir = args[i + 1]
        except IndexError:
            sys.exit("--out-dir needs a folder.")
        del args[i:i + 2]
    try:
        years = [int(a) for a in args]
    except ValueError:
        sys.exit("Usage: python data-processing/export_detections.py <year> [<year> ...] [--out-dir DIR]")
    if not years:
        sys.exit("Usage: python data-processing/export_detections.py <year> [<year> ...] [--out-dir DIR]")

    import psycopg
    from dotenv import load_dotenv

    load_dotenv(os.path.join(HERE, "..", "backend", ".env"))
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set. Fill in backend/.env first (see backend/.env.example).")

    os.makedirs(out_dir, exist_ok=True)
    with psycopg.connect(url) as conn:
        for year in years:
            path = os.path.join(out_dir, f"detections_{year}.csv")
            count = export_year(conn, year, path)
            print(f"{year}: {count:,} detections written to {path}")


if __name__ == "__main__":
    main()
