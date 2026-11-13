"""Storing public fire reports (#52): rate limiting, duplicate linking and
an all-or-nothing write.

Everything for one report happens in a single database transaction:

1. Take a per-sender lock (pg_advisory_xact_lock), so two requests from the
   same sender at the same moment are handled one after the other.
2. Count that sender's recent reports; refuse if over the limit.
3. Find the closest earlier report and satellite detection within
   2 km and 24 h (provisional duplicate linking).
4. Insert the report.

If anything fails (including a database outage half way through) the
transaction is rolled back, so a partial report is never stored. The lock is
released automatically when the transaction ends.
"""

import hashlib

DUPLICATE_RADIUS_M = 2000
DUPLICATE_WINDOW_HOURS = 24


class RateLimited(Exception):
    """The sender has sent too many reports recently."""

    def __init__(self, retry_after_seconds):
        super().__init__("Too many reports")
        self.retry_after_seconds = retry_after_seconds


def client_key(ip_address, salt=""):
    """A salted hash of the sender's IP, so the raw IP is never stored."""
    return hashlib.sha256(f"{salt}:{ip_address or 'unknown'}".encode()).hexdigest()


_POINT = (
    "extensions.st_setsrid(extensions.st_makepoint(%(longitude)s, %(latitude)s), 4326)"
    "::extensions.geography"
)

LOCK_SQL = "select pg_advisory_xact_lock(hashtext(%(client_key)s))"

RECENT_COUNT_SQL = """
    select count(*)
    from public.fire_reports
    where client_key = %(client_key)s
      and created_at > now() - make_interval(mins => %(window_minutes)s)
"""

# Link to the first report of a group, so all copies point at the same one.
NEAREST_REPORT_SQL = f"""
    select coalesce(linked_report_id, id)
    from public.fire_reports
    where extensions.st_dwithin(location, {_POINT}, %(radius_m)s)
      and observed_at between %(observed_at)s - make_interval(hours => %(window_hours)s)
                          and %(observed_at)s + make_interval(hours => %(window_hours)s)
    order by extensions.st_distance(location, {_POINT}), created_at
    limit 1
"""

NEAREST_DETECTION_SQL = f"""
    select id
    from public.detections
    where extensions.st_dwithin(location, {_POINT}, %(radius_m)s)
      and detected_at between %(observed_at)s - make_interval(hours => %(window_hours)s)
                          and %(observed_at)s + make_interval(hours => %(window_hours)s)
    order by extensions.st_distance(location, {_POINT}), detected_at desc
    limit 1
"""

INSERT_SQL = """
    insert into public.fire_reports (
        latitude, longitude, location_source, observed_type, observed_at,
        description, client_key, linked_report_id, linked_detection_id
    ) values (
        %(latitude)s, %(longitude)s, %(location_source)s, %(observed_type)s, %(observed_at)s,
        %(description)s, %(client_key)s, %(linked_report_id)s, %(linked_detection_id)s
    )
    returning id, review_status, linked_report_id, linked_detection_id
"""


def _first_value(cursor):
    row = cursor.fetchone()
    return row[0] if row else None


def save_report(conn, report, key, limit, window_minutes):
    """Store one validated report and return what was saved.

    Raises RateLimited if ``key`` already sent ``limit`` reports in the last
    ``window_minutes``. Database errors are not caught here: the transaction
    rolls back and the caller decides how to answer.
    """
    params = {
        **report,
        "client_key": key,
        "window_minutes": window_minutes,
        "radius_m": DUPLICATE_RADIUS_M,
        "window_hours": DUPLICATE_WINDOW_HOURS,
    }

    with conn.transaction():
        conn.execute(LOCK_SQL, params)

        recent = _first_value(conn.execute(RECENT_COUNT_SQL, params)) or 0
        if recent >= limit:
            raise RateLimited(retry_after_seconds=window_minutes * 60)

        params["linked_report_id"] = _first_value(conn.execute(NEAREST_REPORT_SQL, params))
        params["linked_detection_id"] = _first_value(conn.execute(NEAREST_DETECTION_SQL, params))

        row = conn.execute(INSERT_SQL, params).fetchone()

    return {
        "id": row[0],
        "review_status": row[1],
        "linked_report_id": row[2],
        "linked_detection_id": row[3],
    }
