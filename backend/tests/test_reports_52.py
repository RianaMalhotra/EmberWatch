"""Tests for public fire reports, POST /api/reports (#52).

No live database is needed. FakeReportDB stands in for Postgres: it keeps
reports in memory, makes pg_advisory_xact_lock a real per-sender lock, and
only keeps a transaction's insert if the transaction finishes without an
error (like a real rollback). That lets us test validation, rate limits,
duplicate linking, concurrency and outages without Supabase.
"""
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest

import app as api
from services import report_store
from services.report_store import RateLimited, client_key, save_report
from services.report_validation import validate_report

NOW = datetime(2026, 11, 12, 18, 0, tzinfo=timezone.utc)
SECRET = "postgresql://user:hunter2@db.internal:5432/postgres"


def payload(**overrides):
    body = {
        "latitude": 49.25,
        "longitude": -123.1,
        "location_source": "map",
        "observed_type": "smoke",
        "observed_at": (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(),
        "description": "Grey smoke over the ridge",
    }
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# Fake database
# ---------------------------------------------------------------------------
class _Result:
    def __init__(self, row):
        self.row = row

    def fetchone(self):
        return self.row


class FakeReportDB:
    """In-memory stand-in for the fire_reports / detections tables."""

    def __init__(self, nearest_report=None, nearest_detection=None, fail_on=None):
        self.reports = []            # committed reports
        self.statements = []         # SQL kinds, in order, for checking the steps
        self.nearest_report = nearest_report
        self.nearest_detection = nearest_detection
        self.fail_on = fail_on       # SQL kind that raises, to simulate an outage
        self._locks = {}
        self._guard = threading.Lock()

    def lock_for(self, key):
        with self._guard:
            return self._locks.setdefault(key, threading.Lock())

    def connect(self):
        return FakeConnection(self)


class FakeConnection:
    def __init__(self, db):
        self.db = db
        self.pending = None
        self.held_lock = None

    # `with get_connection() as conn:` support
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    @contextmanager
    def transaction(self):
        self.pending = []
        try:
            yield
        except BaseException:
            self.pending = None          # rollback: nothing is kept
            raise
        else:
            with self.db._guard:
                self.db.reports.extend(self.pending)
            self.pending = None
        finally:
            if self.held_lock:
                self.held_lock.release()  # advisory xact locks end with the transaction
                self.held_lock = None

    def execute(self, sql, params):
        if sql is report_store.LOCK_SQL:
            kind = "lock"
        elif sql is report_store.RECENT_COUNT_SQL:
            kind = "count"
        elif sql is report_store.NEAREST_REPORT_SQL:
            kind = "nearest_report"
        elif sql is report_store.NEAREST_DETECTION_SQL:
            kind = "nearest_detection"
        elif sql is report_store.INSERT_SQL:
            kind = "insert"
        else:
            raise AssertionError(f"unexpected SQL: {sql}")

        self.db.statements.append(kind)
        if self.db.fail_on == kind:
            raise RuntimeError(SECRET)

        if kind == "lock":
            self.held_lock = self.db.lock_for(params["client_key"])
            self.held_lock.acquire()
            return _Result(("",))
        if kind == "count":
            with self.db._guard:
                count = sum(1 for r in self.db.reports if r["client_key"] == params["client_key"])
            return _Result((count,))
        if kind == "nearest_report":
            return _Result((self.db.nearest_report,) if self.db.nearest_report else None)
        if kind == "nearest_detection":
            return _Result((self.db.nearest_detection,) if self.db.nearest_detection else None)

        # insert
        with self.db._guard:
            new_id = len(self.db.reports) + len(self.pending) + 1
        stored = {**params, "id": new_id, "review_status": "unverified"}
        self.pending.append(stored)
        return _Result((new_id, "unverified", params["linked_report_id"], params["linked_detection_id"]))


@pytest.fixture
def client():
    api.app.config["TESTING"] = True
    with api.app.test_client() as test_client:
        yield test_client


@pytest.fixture
def fake_db(monkeypatch):
    def install(**kwargs):
        db = FakeReportDB(**kwargs)
        monkeypatch.setattr(api, "get_connection", db.connect)
        return db
    return install


# ---------------------------------------------------------------------------
# Validation (server side, same rules as the #51 form)
# ---------------------------------------------------------------------------
def test_valid_report_is_cleaned():
    report, errors = validate_report(payload(observed_at="2026-11-12T17:30:00Z",
                                             description="  smoke  "), NOW)
    assert errors == []
    assert report["observed_at"] == datetime(2026, 11, 12, 17, 30, tzinfo=timezone.utc)
    assert report["description"] == "smoke"


def test_blank_description_becomes_null():
    report, errors = validate_report(payload(observed_at="2026-11-12T17:30:00Z",
                                             description="   "), NOW)
    assert errors == [] and report["description"] is None


@pytest.mark.parametrize("field, value", [
    ("latitude", 91), ("latitude", "49"), ("latitude", True), ("latitude", float("nan")),
    ("longitude", -181), ("longitude", None),
    ("location_source", "satellite"),
    ("observed_type", "Smoke"),
    ("observed_at", "yesterday"),
    ("observed_at", "2026-11-12T17:30:00"),      # no timezone
    ("observed_at", "2026-11-12T19:00:00Z"),     # in the future
    ("observed_at", "2026-11-01T17:30:00Z"),     # older than 7 days
    ("description", "x" * 501),
    ("description", 42),
])
def test_invalid_field_is_rejected(field, value):
    body = payload(observed_at="2026-11-12T17:30:00Z")
    body[field] = value
    report, errors = validate_report(body, NOW)
    assert report is None
    assert any(field in error for error in errors)


def test_small_clock_skew_is_allowed():
    _, errors = validate_report(payload(observed_at="2026-11-12T18:04:00Z"), NOW)
    assert errors == []


def test_non_object_body_is_rejected():
    assert validate_report(["not", "an", "object"], NOW) == (None, ["Request body must be a JSON object."])


# ---------------------------------------------------------------------------
# Endpoint contract (matches frontend/src/services/reportApi.js)
# ---------------------------------------------------------------------------
def test_valid_report_returns_201_and_unverified(client, fake_db):
    db = fake_db()
    response = client.post("/api/reports", json=payload())

    assert response.status_code == 201
    body = response.get_json()
    assert body["status"] == "success"
    assert body["data"]["id"] == 1
    assert body["data"]["review_status"] == "unverified"
    assert len(db.reports) == 1
    assert db.statements == ["lock", "count", "nearest_report", "nearest_detection", "insert"]


def test_raw_ip_is_never_stored(client, fake_db, monkeypatch):
    monkeypatch.setenv("REPORT_HASH_SALT", "pepper")
    db = fake_db()
    client.post("/api/reports", json=payload(), headers={"X-Forwarded-For": "203.0.113.7, 10.0.0.1"})

    stored_key = db.reports[0]["client_key"]
    assert "203.0.113.7" not in stored_key
    assert stored_key == client_key("203.0.113.7", "pepper")


def test_invalid_report_returns_400_and_touches_no_database(client, monkeypatch):
    def no_db():
        raise AssertionError("database must not be used for invalid input")
    monkeypatch.setattr(api, "get_connection", no_db)

    response = client.post("/api/reports", json=payload(latitude=200, observed_type="fog"))

    assert response.status_code == 400
    body = response.get_json()
    assert body["status"] == "error"
    assert len(body["errors"]) == 2


def test_non_json_body_returns_400(client, fake_db):
    fake_db()
    response = client.post("/api/reports", data="lat=1", content_type="text/plain")
    assert response.status_code == 400


def test_oversized_body_returns_413(client, fake_db):
    db = fake_db()
    response = client.post("/api/reports", json=payload(description="x" * 20_000))
    assert response.status_code == 413
    assert db.reports == []


# ---------------------------------------------------------------------------
# Rate limiting per sender (device/IP)
# ---------------------------------------------------------------------------
def test_rate_limit_returns_429_with_retry_after(client, fake_db, monkeypatch):
    monkeypatch.setenv("REPORT_RATE_LIMIT", "2")
    monkeypatch.setenv("REPORT_RATE_WINDOW_MINUTES", "10")
    db = fake_db()
    headers = {"X-Forwarded-For": "198.51.100.1"}

    codes = [client.post("/api/reports", json=payload(), headers=headers).status_code for _ in range(3)]

    assert codes == [201, 201, 429]
    assert len(db.reports) == 2
    blocked = client.post("/api/reports", json=payload(), headers=headers)
    assert blocked.headers["Retry-After"] == "600"


def test_rate_limit_is_per_sender(client, fake_db, monkeypatch):
    monkeypatch.setenv("REPORT_RATE_LIMIT", "1")
    db = fake_db()

    first = client.post("/api/reports", json=payload(), headers={"X-Forwarded-For": "198.51.100.1"})
    other = client.post("/api/reports", json=payload(), headers={"X-Forwarded-For": "198.51.100.2"})

    assert (first.status_code, other.status_code) == (201, 201)
    assert len(db.reports) == 2


def test_bad_rate_limit_config_is_not_reported_as_success(client, fake_db, monkeypatch):
    monkeypatch.setenv("REPORT_RATE_LIMIT", "lots")
    db = fake_db()
    response = client.post("/api/reports", json=payload())
    assert response.status_code == 503
    assert db.reports == []


def test_concurrent_requests_cannot_exceed_the_limit():
    """20 requests from one sender at the same moment: the per-sender lock
    makes them run one at a time, so exactly `limit` are stored."""
    db = FakeReportDB()
    report, _ = validate_report(payload(observed_at="2026-11-12T17:30:00Z"), NOW)
    results = []
    start = threading.Barrier(20)

    def send():
        start.wait()
        try:
            save_report(db.connect(), report, "same-sender", limit=5, window_minutes=10)
            results.append("saved")
        except RateLimited:
            results.append("limited")

    threads = [threading.Thread(target=send) for _ in range(20)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert results.count("saved") == 5
    assert results.count("limited") == 15
    assert len(db.reports) == 5


# ---------------------------------------------------------------------------
# Duplicate linking (provisional 2 km / 24 h)
# ---------------------------------------------------------------------------
def test_nearby_report_and_detection_are_linked_not_dropped(client, fake_db):
    db = fake_db(nearest_report=7, nearest_detection=1234)
    response = client.post("/api/reports", json=payload())

    assert response.status_code == 201
    data = response.get_json()["data"]
    assert data["linked_report_id"] == 7
    assert data["linked_detection_id"] == 1234
    assert len(db.reports) == 1   # still stored, so staff see every report


def test_report_with_nothing_nearby_has_no_links(client, fake_db):
    fake_db()
    data = client.post("/api/reports", json=payload()).get_json()["data"]
    assert data["linked_report_id"] is None
    assert data["linked_detection_id"] is None


def test_duplicate_queries_use_2km_and_24h():
    seen = {}

    class Recorder(FakeConnection):
        def execute(self, sql, params):
            if sql is report_store.NEAREST_REPORT_SQL:
                seen.update(params)
            return super().execute(sql, params)

    report, _ = validate_report(payload(observed_at="2026-11-12T17:30:00Z"), NOW)
    save_report(Recorder(FakeReportDB()), report, "k", limit=5, window_minutes=10)

    assert seen["radius_m"] == 2000
    assert seen["window_hours"] == 24
    assert "st_dwithin" in report_store.NEAREST_REPORT_SQL
    assert "st_dwithin" in report_store.NEAREST_DETECTION_SQL


# ---------------------------------------------------------------------------
# Database failures: 503 and no partial record
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("failing_step", ["lock", "count", "nearest_report", "nearest_detection", "insert"])
def test_outage_at_any_step_saves_nothing(client, fake_db, failing_step):
    db = fake_db(fail_on=failing_step)
    response = client.post("/api/reports", json=payload())

    assert response.status_code == 503
    body = response.get_json()
    assert body["status"] == "unavailable"
    assert "hunter2" not in response.get_data(as_text=True)
    assert db.reports == []


def test_database_not_configured_returns_503(client, monkeypatch):
    from db import DatabaseNotConfigured

    def not_configured():
        raise DatabaseNotConfigured("DATABASE_URL is not set")
    monkeypatch.setattr(api, "get_connection", not_configured)

    response = client.post("/api/reports", json=payload())
    assert response.status_code == 503
