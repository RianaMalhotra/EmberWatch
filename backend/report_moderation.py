"""Report moderation: all writes run on the backend with staff authorization."""
import os
import hmac
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request
from db import get_connection

reports_bp = Blueprint("reports", __name__)
STATUSES = frozenset({"unverified", "confirmed", "rejected", "out_of_control", "being_held", "under_control", "out"})
ACTIVE = tuple(sorted(STATUSES - {"rejected", "out"}))

def _staff():
    """Validate a server-configured bearer token; never trust a client-supplied role."""
    expected = os.environ.get("REPORTS_STAFF_TOKEN", "")
    auth = request.headers.get("Authorization", "")
    if not expected or not auth.startswith("Bearer "):
        return False
    return hmac.compare_digest(auth[7:], expected)

@reports_bp.get("/api/reports")
def active_reports():
    try:
        with get_connection() as conn:
            rows = conn.execute(
                "select id,latitude,longitude,sighting,observed_at,review_status,created_at "
                "from public.fire_reports where review_status = any(%s) order by created_at desc limit 500",
                (list(ACTIVE),),
            ).fetchall()
        return jsonify({"status": "success", "data": [
            dict(zip(("id","latitude","longitude","sighting","observed_at","review_status","created_at"), row))
            for row in rows
        ]}), 200
    except Exception:
        reports_bp.logger if False else None
        return jsonify({"status": "unavailable", "message": "Reports unavailable"}), 503

@reports_bp.patch("/api/reports/<int:report_id>/status")
def moderate_report(report_id):
    if not _staff():
        return jsonify({"status": "error", "message": "Staff authorization required"}), 403
    body = request.get_json(silent=True)
    status = body.get("status") if isinstance(body, dict) else None
    if status not in STATUSES or status == "unverified":
        return jsonify({"status": "error", "message": "Invalid moderation status"}), 400
    staff_id = os.environ.get("REPORTS_STAFF_ID", "staff")
    try:
        with get_connection() as conn:
            row = conn.execute("select review_status from public.fire_reports where id=%s for update", (report_id,)).fetchone()
            if row is None:
                return jsonify({"status": "error", "message": "Report not found"}), 404
            previous = row[0]
            if previous == status:
                return jsonify({"status": "success", "data": {"id": report_id, "review_status": status, "unchanged": True}}), 200
            conn.execute("update public.fire_reports set review_status=%s where id=%s", (status, report_id))
            conn.execute(
                "insert into public.fire_report_audit(report_id,old_status,new_status,staff_id) values (%s,%s,%s,%s)",
                (report_id, previous, status, staff_id),
            )
        return jsonify({"status": "success", "data": {"id": report_id, "review_status": status}}), 200
    except Exception:
        return jsonify({"status": "unavailable", "message": "Moderation unavailable"}), 503

@reports_bp.get("/api/reports/<int:report_id>/audit")
def report_audit(report_id):
    if not _staff():
        return jsonify({"status": "error", "message": "Staff authorization required"}), 403
    try:
        with get_connection() as conn:
            rows = conn.execute(
                "select old_status,new_status,staff_id,changed_at from public.fire_report_audit "
                "where report_id=%s order by changed_at desc", (report_id,),
            ).fetchall()
        return jsonify({"status": "success", "data": [
            dict(zip(("old_status","new_status","staff_id","changed_at"), row)) for row in rows
        ]}), 200
    except Exception:
        return jsonify({"status": "unavailable", "message": "Audit history unavailable"}), 503
