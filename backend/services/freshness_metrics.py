"""Read-only ingestion freshness metrics; timestamps never imply active fires."""
from datetime import datetime, timezone

def detection_freshness(conn, now=None, stale_hours=6):
    now = now or datetime.now(timezone.utc)
    with conn.cursor() as cur:
        cur.execute("SELECT count(*), max(detected_at), max(created_at) FROM public.detections")
        count, newest_detection, newest_insert = cur.fetchone()
    def iso(value):
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if value else None
    def hours(value):
        return round(max(0, (now - value).total_seconds()) / 3600, 2) if value else None
    age = hours(newest_insert)
    return {"total_detections": count, "latest_detection_at": iso(newest_detection),
            "latest_insert_at": iso(newest_insert), "latest_insert_age_hours": age,
            "ingestion_stale": age is None or age > stale_hours,
            "stale_threshold_hours": stale_hours,
            "note": "A recent insert does not prove active fires; no new fires can also mean no detections."}
