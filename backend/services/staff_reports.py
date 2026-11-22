"""Staff-only report review queries; no client-controlled SQL fragments."""

LIST_SQL = """
select id, latitude, longitude, location_source, observed_type, observed_at,
       description, review_status, linked_report_id, linked_detection_id, created_at
from public.fire_reports
where (%(status)s::text is null or review_status = %(status)s)
order by created_at desc, id desc
limit %(limit)s
"""

REVIEW_SQL = """
update public.fire_reports
set review_status = %(status)s
where id = %(id)s and review_status = 'unverified'
returning id, review_status
"""

COLUMNS = ("id", "latitude", "longitude", "location_source", "observed_type",
           "observed_at", "description", "review_status", "linked_report_id",
           "linked_detection_id", "created_at")


def list_reports(conn, status=None, limit=100):
    with conn.cursor() as cur:
        cur.execute(LIST_SQL, {"status": status, "limit": limit})
        return [dict(zip(COLUMNS, row)) for row in cur.fetchall()]


def review_report(conn, report_id, status):
    # One-way state transition: verified/rejected decisions cannot be silently overwritten.
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(REVIEW_SQL, {"id": report_id, "status": status})
            row = cur.fetchone()
    return {"id": row[0], "review_status": row[1]} if row else None
