"""Load a cleaned FIRMS CSV into the Supabase `detections` table.

Run firms_cleaning.py first, then (from the repository root):

    python data-processing/load_firms_to_db.py data-processing/data/cleaned.csv

The database URL is read from DATABASE_URL (backend/.env is loaded
automatically). Rows already in the table are skipped, so re-running
the script on overlapping files is safe.
"""

import csv
import os
import sys

# Where a row came from, stored in detections.source (#46 provenance).
ARCHIVE_SOURCE = "NASA FIRMS"

INSERT_SQL = """
    insert into public.detections
        (latitude, longitude, detected_at, confidence, confidence_class,
         instrument, satellite, frp, daynight, fire_type, source)
    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    on conflict on constraint detections_unique do nothing
"""


def _optional(value, convert=str):
    """Empty CSV cells become NULL, never a made-up value (#27)."""
    if value is None or str(value).strip() == "":
        return None
    return convert(value)


def build_rows(cleaned_rows, source=ARCHIVE_SOURCE):
    """Turn cleaned rows (dicts) into tuples for INSERT_SQL."""
    return [
        (
            float(row["latitude"]),
            float(row["longitude"]),
            row["timestamp"],
            float(row["confidence"]),
            row["confidence_class"],
            _optional(row.get("instrument")),
            _optional(row.get("satellite")),
            _optional(row.get("frp"), float),
            _optional(row.get("daynight")),
            _optional(row.get("type"), int),
            source,
        )
        for row in cleaned_rows
    ]


def insert_detections(conn, rows, batch_size=1000):
    """Insert rows in batches. Returns the number of new rows inserted."""
    inserted = 0
    with conn.cursor() as cur:
        for start in range(0, len(rows), batch_size):
            batch = rows[start:start + batch_size]
            cur.executemany(INSERT_SQL, batch)
            inserted += max(cur.rowcount, 0)
    conn.commit()
    return inserted


def main(path):
    import psycopg
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "backend", ".env"))
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set. Fill in backend/.env first (see backend/.env.example).")

    with open(path, newline="", encoding="utf-8") as source:
        rows = build_rows(csv.DictReader(source))

    with psycopg.connect(url) as conn:
        inserted = insert_detections(conn, rows)
    print(f"Inserted {inserted} new detections ({len(rows) - inserted} already in the database).")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python data-processing/load_firms_to_db.py <cleaned.csv>")
    main(sys.argv[1])
