"""Tests for scripts/check_migrations.py (issue #61). No database: a fake connection answers."""
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import check_migrations as cm  # noqa: E402

SECRET_URL = "postgresql://postgres.secretref:hunter2@db.secret-host.example.com:5432/postgres"


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return list(self.rows)


class FakeConnection:
    """Answers each check's SQL from a dict, and records everything it was asked."""

    def __init__(self, **overrides):
        self.answers = {
            cm.VERSION_SQL: [("170004",)],
            cm.POSTGIS_SQL: [(1,)],
            cm.TABLES_SQL: [(name, True) for name in cm.TABLES],
            cm.COLUMNS_SQL: [(name,) for name in cm.TERRAIN_COLUMNS],
            cm.CONSTRAINT_SQL: [("UNIQUE NULLS NOT DISTINCT (a, b)",)],
            cm.NULL_SATELLITE_SQL: [(0,)], cm.NULL_DUPLICATES_SQL: [(0,)],
            "areas": [(13,)], "detections": [(5000,)], "fire_reports": [(0,)],
        }
        self.answers.update(overrides)
        self.asked = []
        self.closed = False

    def execute(self, sql, params=None):
        self.asked.append(sql)
        if sql in self.answers:
            return FakeCursor(self.answers[sql])
        return FakeCursor(self.answers[sql.rsplit(".", 1)[1]])  # "select count(*) from public.<table>"

    def close(self):
        self.closed = True


def result_for(results, prefix):
    return next(item for item in results if item.name.startswith(prefix))


def test_healthy_database_passes_everything():
    results = cm.run_checks(FakeConnection())
    assert all(item.outcome == cm.PASS for item in results)
    assert result_for(results, "Rows in areas").detail == "13 row(s)"


def test_old_postgres_fails():
    results = cm.run_checks(FakeConnection(**{cm.VERSION_SQL: [("140012",)]}))
    assert result_for(results, "PostgreSQL").outcome == cm.FAIL


def test_missing_postgis_fails():
    results = cm.run_checks(FakeConnection(**{cm.POSTGIS_SQL: [(0,)]}))
    assert result_for(results, "PostGIS").outcome == cm.FAIL


def test_a_missing_table_is_named_and_rls_cannot_be_confirmed():
    tables = [(name, True) for name in cm.TABLES if name != "fire_reports"]
    results = cm.run_checks(FakeConnection(**{cm.TABLES_SQL: tables}))
    assert "fire_reports" in result_for(results, "Tables exist").detail
    assert result_for(results, "Row level security").outcome == cm.FAIL
    assert not any(item.name == "Rows in fire_reports" for item in results)


def test_row_level_security_off_is_named():
    tables = [(name, name != "areas") for name in cm.TABLES]
    results = cm.run_checks(FakeConnection(**{cm.TABLES_SQL: tables}))
    assert result_for(results, "Row level security").outcome == cm.FAIL
    assert "areas" in result_for(results, "Row level security").detail


def test_missing_terrain_columns_are_named():
    results = cm.run_checks(FakeConnection(**{cm.COLUMNS_SQL: [("province",)]}))
    detail = result_for(results, "Terrain").detail
    assert result_for(results, "Terrain").outcome == cm.FAIL
    assert "slope_deg" in detail and "province" not in detail


def test_old_unique_constraint_fails():
    results = cm.run_checks(FakeConnection(**{cm.CONSTRAINT_SQL: [("UNIQUE (a, b)",)]}))
    assert result_for(results, "detections_unique").outcome == cm.FAIL
    results = cm.run_checks(FakeConnection(**{cm.CONSTRAINT_SQL: []}))
    assert result_for(results, "detections_unique").detail == "constraint not found"


def test_precheck_for_migration_3_is_safe_when_there_are_no_duplicates():
    results = cm.run_checks(FakeConnection(**{cm.NULL_SATELLITE_SQL: [(12,)]}))
    item = result_for(results, "Pre-check for migration 3")
    assert item.outcome == cm.PASS and "12 rows with no satellite" in item.detail


def test_precheck_for_migration_3_warns_about_duplicates():
    results = cm.run_checks(FakeConnection(**{cm.NULL_SATELLITE_SQL: [(40,)], cm.NULL_DUPLICATES_SQL: [(3,)]}))
    item = result_for(results, "Pre-check for migration 3")
    assert item.outcome == cm.WARN and "3 duplicated group(s)" in item.detail


def test_empty_areas_or_detections_warn_but_empty_reports_do_not():
    results = cm.run_checks(FakeConnection(areas=[(0,)], detections=[(0,)], fire_reports=[(0,)]))
    assert result_for(results, "Rows in areas").outcome == cm.WARN
    assert result_for(results, "Rows in detections").outcome == cm.WARN
    assert result_for(results, "Rows in fire_reports").outcome == cm.PASS


def test_only_read_queries_are_sent():
    conn = FakeConnection()
    cm.run_checks(conn)
    forbidden = ("insert ", "update ", "delete ", "drop ", "alter ", "create ", "truncate ", "grant ")
    assert conn.asked
    assert not [sql for sql in conn.asked if sql.lower().lstrip().startswith(forbidden)]
    assert all(sql.lower().startswith("select") or sql.lower().startswith("show") for sql in conn.asked)


def test_main_reports_and_closes_the_connection(capsys):
    conn = FakeConnection()
    code = cm.main(env={"DATABASE_URL": SECRET_URL}, connect=lambda url: conn)
    out = capsys.readouterr().out
    assert code == 0 and conn.closed
    assert "| Tables exist (migrations 1 and 4) | PASS |" in out
    assert SECRET_URL not in out and "hunter2" not in out


def test_main_exit_code_is_1_when_a_check_fails(capsys):
    conn = FakeConnection(**{cm.POSTGIS_SQL: [(0,)]})
    assert cm.main(env={"DATABASE_URL": SECRET_URL}, connect=lambda url: conn) == 1
    assert "FAIL" in capsys.readouterr().out


def test_connection_errors_do_not_leak_the_host_or_password(capsys):
    def boom(url):
        raise OSError(f'connection to server at "db.secret-host.example.com" failed for {url}')

    assert cm.main(env={"DATABASE_URL": SECRET_URL}, connect=boom) == 1
    out = capsys.readouterr().out
    assert "secret-host" not in out and "hunter2" not in out and "OSError" in out


def test_missing_database_url_is_a_usage_error(capsys, tmp_path):
    assert cm.main(env={}, env_path=str(tmp_path / "missing.env")) == 2
    assert "DATABASE_URL is not set" in capsys.readouterr().err


def test_database_url_is_read_from_the_env_file(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("# comment\nOTHER=1\nDATABASE_URL='postgresql://u:p@h/db'\n", encoding="utf-8")
    assert cm.load_database_url(env={}, env_path=str(env_file)) == "postgresql://u:p@h/db"
    assert cm.load_database_url(env={"DATABASE_URL": "from-env"}, env_path=str(env_file)) == "from-env"


def test_report_counts_results():
    report = cm.format_report([cm.Result("A", cm.PASS, "ok"), cm.Result("B", cm.WARN, "hm"), cm.Result("C", cm.FAIL, "bad")])
    assert "| A | PASS | ok |" in report
    assert "3 checks: 1 passed, 1 warning(s), 1 failed." in report
