"""Backfill Canadian MODIS observations; dry run unless --apply is supplied."""
import argparse
import csv
import io
import os
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import quote

from fetch_firms_nrt import (CANADA_BBOX, fetch_text, parse_csv,
                            normalize_satellite, keep_canada)
from firms_cleaning import clean_rows
from load_firms_to_db import build_rows, INSERT_SQL

ROOT = "https://firms.modaps.eosdis.nasa.gov/api"
LIMIT = 400 * 1024 * 1024

def windows(start, end, availability):
    while start <= end:
        source = next((s for s in ("MODIS_SP", "MODIS_NRT")
                       if s in availability and availability[s][0] <= start <= availability[s][1]), None)
        if source is None:
            raise ValueError(f"No MODIS product available for {start}")
        stop = min(end, start + timedelta(days=4), availability[source][1])
        yield source, start, stop
        start = stop + timedelta(days=1)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", type=date.fromisoformat, default=date(2026, 1, 1))
    parser.add_argument("--end", type=date.fromisoformat, default=date(2026, 11, 13))
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.start > args.end or args.end >= date.today():
        parser.error("Choose a valid past date interval")
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / "backend" / ".env")
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not key:
        parser.error("FIRMS_MAP_KEY required")
    token = quote(key, safe="")
    conn = None
    try:
        raw = fetch_text(f"{ROOT}/data_availability/csv/{token}/all")
        availability = {row["data_id"]: (date.fromisoformat(row["min_date"]), date.fromisoformat(row["max_date"]))
                        for row in csv.DictReader(io.StringIO(raw)) if row.get("data_id") in ("MODIS_SP", "MODIS_NRT")}
        plan = list(windows(args.start, args.end, availability))
        if args.apply:
            import psycopg
            conn = psycopg.connect(os.environ["DATABASE_URL"])
        total = inserted = 0
        for source, start, stop in plan:
            days = (stop - start).days + 1
            raw = fetch_text(f"{ROOT}/area/csv/{token}/{source}/{CANADA_BBOX}/{days}/{start}")
            cleaned, report = clean_rows(normalize_satellite(parse_csv(raw)))
            cleaned, report = keep_canada(cleaned, report)
            if any(not start.isoformat() <= row["timestamp"][:10] <= stop.isoformat() for row in cleaned):
                raise ValueError("FIRMS returned observations outside requested window")
            rows = build_rows(cleaned, source=f"NASA FIRMS {source}")
            total += len(rows)
            if conn:
                with conn.transaction():
                    with conn.cursor() as cur:
                        cur.execute("SELECT pg_database_size(current_database())")
                        size = cur.fetchone()[0]
                        if size + len(rows) * 1024 >= LIMIT:
                            raise RuntimeError("Storage safety threshold reached; stopping before next window")
                        for offset in range(0, len(rows), 1000):
                            cur.executemany(INSERT_SQL, rows[offset:offset+1000])
                            inserted += max(cur.rowcount, 0)
                conn.commit()
            print(f"{source} {start} through {stop}: {len(rows)} usable records", flush=True)
        print(f"Fetched {total}; inserted {inserted}" if args.apply else f"Dry run: {total} candidate observations; no writes")
    except Exception as error:
        raise SystemExit(str(error).replace(key, "***").replace(token, "***")) from None
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    main()
