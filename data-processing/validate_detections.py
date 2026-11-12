"""Check the stored FIRMS detections in Supabase (#46).

Read-only: it runs SELECT queries and prints a report, it never changes data.

    python data-processing/validate_detections.py

The database URL is read from DATABASE_URL (backend/.env is loaded
automatically). The script exits with code 1 if any check fails, so it can
be run after every load.

Errors are problems that should never be in the table (duplicates, future
timestamps, a confidence class that does not match its score, ...).
Warnings are things worth knowing but not wrong in themselves (months with
no detections, rows that FIRMS marks as non-wildfire sources).
"""

import os
import sys

ERROR = "error"
WARNING = "warning"

# Each check is one query that returns a single number: how many rows (or
# groups) have the problem. 0 means the check passed.
CHECKS = [
    {
        "name": "duplicate detections",
        "level": ERROR,
        "detail": "same location, time and satellite stored more than once "
                  "(a missing satellite counts as the same value)",
        "sql": """
            select count(*) from (
                select 1 from public.detections
                group by latitude, longitude, detected_at, coalesce(satellite, '')
                having count(*) > 1
            ) as duplicate_groups
        """,
    },
    {
        "name": "detections in the future",
        "level": ERROR,
        "detail": "detected_at is later than now, so the timestamp is wrong",
        "sql": "select count(*) from public.detections where detected_at > now()",
    },
    {
        "name": "detections before FIRMS existed",
        "level": ERROR,
        "detail": "detected_at is before MODIS started (2000-11-01)",
        "sql": "select count(*) from public.detections "
               "where detected_at < timestamptz '2000-11-01 00:00:00+00'",
    },
    {
        "name": "timestamps with seconds",
        "level": ERROR,
        "detail": "FIRMS times are HHMM, so seconds mean the time was parsed wrongly",
        "sql": "select count(*) from public.detections "
               "where detected_at <> date_trunc('minute', detected_at)",
    },
    {
        "name": "confidence class does not match score",
        "level": ERROR,
        "detail": "MODIS rule: 0-29 low, 30-79 nominal, 80-100 high",
        "sql": """
            select count(*) from public.detections
            where instrument = 'MODIS'
              and confidence_class <> case
                  when confidence <= 29 then 'low'
                  when confidence <= 79 then 'nominal'
                  else 'high'
              end
        """,
    },
    {
        "name": "missing satellite",
        "level": ERROR,
        "detail": "satellite is part of the duplicate check, so it must be known",
        "sql": "select count(*) from public.detections where satellite is null",
    },
    {
        "name": "negative fire radiative power",
        "level": ERROR,
        "detail": "frp is in MW and cannot be below 0",
        "sql": "select count(*) from public.detections where frp < 0",
    },
    {
        "name": "months with no detections",
        "level": WARNING,
        "detail": "calendar months between the first and last detection with no rows "
                  "(possible missing download)",
        "sql": """
            with bounds as (
                select date_trunc('month', min(detected_at)) as first_month,
                       date_trunc('month', max(detected_at)) as last_month
                from public.detections
            )
            select count(*)
            from bounds,
                 generate_series(first_month, last_month, interval '1 month') as month
            where not exists (
                select 1 from public.detections d
                where d.detected_at >= month and d.detected_at < month + interval '1 month'
            )
        """,
    },
    {
        "name": "non-wildfire detections",
        "level": WARNING,
        "detail": "FIRMS type 1 (volcano), 2 (other static land source, e.g. industry) "
                  "or 3 (offshore): heat sources that are not vegetation fires",
        "sql": "select count(*) from public.detections where fire_type in (1, 2, 3)",
    },
    {
        "name": "unknown fire type",
        "level": WARNING,
        "detail": "type is only in the FIRMS archive files, not near-real-time data",
        "sql": "select count(*) from public.detections where fire_type is null",
    },
]

SUMMARY_SQL = """
    select count(*),
           min(detected_at),
           max(detected_at),
           count(distinct satellite),
           min(created_at),
           max(created_at)
    from public.detections
"""


def _count(cur, sql):
    cur.execute(sql)
    return int(cur.fetchone()[0])


def run_checks(conn, checks=CHECKS):
    """Run every check. Returns (summary dict, list of result dicts)."""
    with conn.cursor() as cur:
        cur.execute(SUMMARY_SQL)
        total, first, last, satellites, loaded_first, loaded_last = cur.fetchone()
        summary = {
            "total": int(total),
            "first_detection": first,
            "last_detection": last,
            "satellites": int(satellites),
            "first_loaded": loaded_first,
            "last_loaded": loaded_last,
        }
        if summary["total"] == 0:
            # Every count would be 0 and "pass", which would be misleading.
            empty = {"name": "table has data", "level": ERROR,
                     "detail": "public.detections is empty", "count": 1, "passed": False}
            return summary, [empty]

        results = []
        for check in checks:
            count = _count(cur, check["sql"])
            results.append({
                "name": check["name"],
                "level": check["level"],
                "detail": check["detail"],
                "count": count,
                "passed": count == 0,
            })
    return summary, results


def has_errors(results):
    return any(r["level"] == ERROR and not r["passed"] for r in results)


def format_report(summary, results):
    lines = [
        f"Detections: {summary['total']:,}",
        f"Detected between {summary['first_detection']} and {summary['last_detection']}",
        f"Satellites: {summary['satellites']}",
        f"Loaded between {summary['first_loaded']} and {summary['last_loaded']}",
        "",
    ]
    for r in results:
        if r["passed"]:
            mark = "PASS"
        else:
            mark = "FAIL" if r["level"] == ERROR else "WARN"
        lines.append(f"[{mark}] {r['name']}: {r['count']:,}")
        if not r["passed"]:
            lines.append(f"       {r['detail']}")

    errors = sum(1 for r in results if r["level"] == ERROR and not r["passed"])
    warnings = sum(1 for r in results if r["level"] == WARNING and not r["passed"])
    lines += ["", f"{errors} error(s), {warnings} warning(s)"]
    return "\n".join(lines)


def main():
    import psycopg
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "backend", ".env"))
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set. Fill in backend/.env first (see backend/.env.example).")

    with psycopg.connect(url) as conn:
        summary, results = run_checks(conn)
    print(format_report(summary, results))
    return 1 if has_errors(results) else 0


if __name__ == "__main__":
    sys.exit(main())
