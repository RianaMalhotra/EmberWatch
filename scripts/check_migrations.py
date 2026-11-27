"""Check that the Supabase database matches the repository migrations (issue #61).

    python scripts/check_migrations.py

Reads DATABASE_URL from the environment or from backend/.env. The check is
read-only (the transaction is opened read-only and nothing is written), and
the connection string is never printed. It prints a Markdown table to paste
into the issue as evidence.

Exit code: 0 when nothing failed, 1 when a check failed or the database
could not be reached, 2 when DATABASE_URL is not set.
"""
import os
import sys
from collections import namedtuple

PASS, FAIL, WARN = "PASS", "FAIL", "WARN"
Result = namedtuple("Result", "name outcome detail")

TABLES = ("detections", "areas", "environmental_observations", "risk_assessments", "fire_reports", "fire_report_audit")
TERRAIN_COLUMNS = ("province", "elevation_m", "slope_deg", "terrain_source", "terrain_retrieved_at")
MIN_POSTGRES_VERSION = 150000  # migration 3 uses NULLS NOT DISTINCT (PostgreSQL 15+)

VERSION_SQL = "show server_version_num"
POSTGIS_SQL = "select count(*) from pg_extension where extname = 'postgis'"
TABLES_SQL = (
    "select relname, relrowsecurity from pg_class "
    "where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and relname = any(%s)"
)
COLUMNS_SQL = (
    "select column_name from information_schema.columns "
    "where table_schema = 'public' and table_name = 'areas' and column_name = any(%s)"
)
CONSTRAINT_SQL = (
    "select pg_get_constraintdef(oid) from pg_constraint "
    "where conrelid = to_regclass('public.detections') and conname = 'detections_unique'"
)
STATUS_CONSTRAINT_SQL = (
    "select pg_get_constraintdef(oid) from pg_constraint "
    "where conrelid = to_regclass('public.fire_reports') and conname = 'fire_reports_review_status_check'"
)
NEW_STATUS = "under_control"  # one of the statuses migration 5 adds
NULL_SATELLITE_SQL = "select count(*) from public.detections where satellite is null"
NULL_DUPLICATES_SQL = (
    "select count(*) from (select 1 from public.detections where satellite is null "
    "group by latitude, longitude, detected_at having count(*) > 1) duplicated"
)
COUNT_SQL = "select count(*) from public.{table}"


def load_database_url(env=None, env_path=None):
    """DATABASE_URL from the environment, else from backend/.env. None if missing."""
    env = os.environ if env is None else env
    url = (env.get("DATABASE_URL") or "").strip()
    if url:
        return url
    path = env_path or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend", ".env")
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                key, sep, value = line.strip().partition("=")
                if sep and key.strip() == "DATABASE_URL":
                    return value.strip().strip("'\"") or None
    except OSError:
        pass
    return None


def run_checks(conn):
    """Run every check on an open connection and return a list of Result."""
    results = []

    version = int(conn.execute(VERSION_SQL).fetchone()[0])
    major = version // 10000
    results.append(Result("PostgreSQL 15 or newer", PASS if version >= MIN_POSTGRES_VERSION else FAIL,
                          f"server major version {major}"))

    has_postgis = conn.execute(POSTGIS_SQL).fetchone()[0] > 0
    results.append(Result("PostGIS extension (migration 1)", PASS if has_postgis else FAIL,
                          "installed" if has_postgis else "extension 'postgis' not found"))

    found = {name: rls for name, rls in conn.execute(TABLES_SQL, (list(TABLES),)).fetchall()}
    missing = [name for name in TABLES if name not in found]
    results.append(Result("Tables exist (migrations 1, 4 and 5)", FAIL if missing else PASS,
                          f"missing: {', '.join(missing)}" if missing else f"all {len(TABLES)} found"))

    no_rls = [name for name in TABLES if name in found and not found[name]]
    results.append(Result("Row level security on", FAIL if no_rls or missing else PASS,
                          f"off for: {', '.join(no_rls)}" if no_rls else
                          ("cannot check, tables missing" if missing else "on for all tables")))

    columns = {row[0] for row in conn.execute(COLUMNS_SQL, (list(TERRAIN_COLUMNS),)).fetchall()}
    absent = [name for name in TERRAIN_COLUMNS if name not in columns]
    results.append(Result("Terrain columns on areas (migration 2)", FAIL if absent else PASS,
                          f"missing: {', '.join(absent)}" if absent else "all 5 found"))

    row = conn.execute(CONSTRAINT_SQL).fetchone()
    if row is None:
        results.append(Result("detections_unique (migration 3)", FAIL, "constraint not found"))
    elif "NULLS NOT DISTINCT" in str(row[0]).upper():
        results.append(Result("detections_unique (migration 3)", PASS, "treats a missing satellite as one value"))
    else:
        results.append(Result("detections_unique (migration 3)", FAIL,
                              "constraint exists but is the old version (without NULLS NOT DISTINCT)"))

    # Migration 5 widens the allowed review statuses; the staff routes need that.
    if "fire_reports" in found:
        row = conn.execute(STATUS_CONSTRAINT_SQL).fetchone()
        if row is not None and NEW_STATUS in str(row[0]):
            results.append(Result("Review statuses (migration 5)", PASS, "the moderation statuses are allowed"))
        else:
            results.append(Result("Review statuses (migration 5)", FAIL,
                                  "fire_reports does not allow the moderation statuses yet: apply migration 5"))

    # Migration 3 turns "no satellite" into one value, so it fails if two rows with
    # no satellite share a location and time. Check that before applying it.
    if "detections" in found:
        no_satellite = conn.execute(NULL_SATELLITE_SQL).fetchone()[0]
        duplicated = conn.execute(NULL_DUPLICATES_SQL).fetchone()[0]
        if duplicated:
            results.append(Result("Pre-check for migration 3", WARN,
                                  f"{no_satellite} rows with no satellite, {duplicated} duplicated group(s): "
                                  "remove the duplicates before applying migration 3"))
        else:
            results.append(Result("Pre-check for migration 3", PASS,
                                  f"{no_satellite} rows with no satellite, no duplicates: safe to apply"))

    # Informational row counts: an empty table is not an error but is worth seeing.
    for table in ("areas", "detections", "fire_reports"):
        if table in found:
            count = conn.execute(COUNT_SQL.format(table=table)).fetchone()[0]
            outcome = WARN if count == 0 and table != "fire_reports" else PASS
            results.append(Result(f"Rows in {table}", outcome, f"{count} row(s)"))
    return results


def format_report(results):
    lines = ["**Migration check of the Supabase database**", "", "| Check | Result | Detail |", "|---|---|---|"]
    lines += [f"| {item.name} | {item.outcome} | {item.detail} |" for item in results]
    failed = sum(1 for item in results if item.outcome == FAIL)
    warned = sum(1 for item in results if item.outcome == WARN)
    lines += ["", f"{len(results)} checks: {len(results) - failed - warned} passed, {warned} warning(s), {failed} failed."]
    return "\n".join(lines)


def _connect(url):
    import psycopg  # imported here so the tests need no database driver
    conn = psycopg.connect(url, connect_timeout=10)
    conn.read_only = True
    return conn


def main(env=None, connect=None, env_path=None):
    url = load_database_url(env, env_path)
    if not url:
        print("Error: DATABASE_URL is not set. Put it in backend/.env or the environment.", file=sys.stderr)
        return 2
    try:
        conn = (connect or _connect)(url)
        try:
            results = run_checks(conn)
        finally:
            conn.close()
    except Exception as error:  # never echo the message: it can contain the host or user
        print(f"FAIL: could not run the checks ({type(error).__name__}). "
              "Check DATABASE_URL, your network and that the database is not paused.")
        return 1
    print(format_report(results))
    return 1 if any(item.outcome == FAIL for item in results) else 0


if __name__ == "__main__":
    sys.exit(main())
