"""Report moderation: all writes run on the backend with staff authorization."""
import os
import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from flask import Blueprint, current_app, jsonify, request
from db import get_connection

reports_bp = Blueprint("reports", __name__)
STATUSES = frozenset({"unverified", "verified", "confirmed", "rejected", "out_of_control", "being_held", "under_control", "out"})
ALLOWED_TRANSITIONS = {"unverified":["verified","confirmed","rejected"],"verified":["confirmed","rejected"],"confirmed":["out_of_control","being_held","under_control","out","rejected"],"out_of_control":["being_held","under_control","out","rejected"],"being_held":["out_of_control","under_control","out","rejected"],"under_control":["out_of_control","being_held","out","rejected"],"out":["confirmed"],"rejected":["verified"]}
ACTIVE = tuple(sorted(STATUSES - {"rejected", "out"}))
PUBLIC_REPORT_FIELDS = ("id", "latitude", "longitude", "observed_type", "description", "observed_at", "review_status", "created_at")


def _public_report(row):
    """Never publish raw text or precise GPS for unreviewed community reports."""
    report = dict(zip(PUBLIC_REPORT_FIELDS, row))
    if report["review_status"] == "unverified":
        report["description"] = None
    # Apply approximate location to ALL public reports; staff need separate authorized detail.
    for coordinate in ("latitude", "longitude"):
        if report[coordinate] is not None:
            report[coordinate] = round(float(report[coordinate]), 2)
    return report


def _staff():
    """Verify a Supabase access token with Supabase Auth and allowlist its user ID.

    Never trust client-supplied roles, IDs, or unverified JWT claims.
    Fail closed if Auth is unavailable or not configured.
    """
    auth = request.headers.get("Authorization", "")
    token = auth[7:].strip() if auth.startswith("Bearer ") else ""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    anon_key = os.environ.get("SUPABASE_ANON_KEY", "")
    allowed = {uid.strip() for uid in os.environ.get("REPORTS_STAFF_USER_IDS", "").split(",") if uid.strip()}
    if not (token and base.startswith("https://") and anon_key and allowed):
        return None
    try:
        req = Request(
            base + "/auth/v1/user",
            headers={"Authorization": "Bearer " + token, "apikey": anon_key},
        )
        with urlopen(req, timeout=5) as response:
            user = json.load(response)
        uid = user.get("id") if isinstance(user, dict) else None
        return uid if isinstance(uid, str) and uid in allowed else None
    except (HTTPError, URLError, TimeoutError, ValueError, OSError):
        return None

@reports_bp.get("/api/reports")
def active_reports():
    try:
        with get_connection() as conn:
            rows = conn.execute(
                "select id,latitude,longitude,observed_type,description,observed_at,review_status,created_at "
                "from public.fire_reports where review_status = any(%s) order by created_at desc limit 500",
                (list(ACTIVE),),
            ).fetchall()
        return jsonify({"status": "success", "data": [
            _public_report(row)
            for row in rows
        ]}), 200
    except Exception:
        current_app.logger.exception("Could not load public reports")
        return jsonify({"status": "unavailable", "message": "Reports unavailable"}), 503

@reports_bp.get("/api/staff/reports")
def staff_reports():
    """Full report queue, including rejected/out, accessible only to allowlisted staff."""
    if not _staff():
        return jsonify({"status": "error", "message": "Staff authorization required"}), 403
    try:
        with get_connection() as conn:
            rows = conn.execute(
                "select id,latitude,longitude,observed_type,description,observed_at,review_status,created_at "
                "from public.fire_reports order by created_at desc limit 500"
            ).fetchall()
        return jsonify({"status": "success", "data": [
            dict(zip(PUBLIC_REPORT_FIELDS, row)) for row in rows
        ]}), 200
    except Exception:
        current_app.logger.exception("Could not load staff reports")
        return jsonify({"status": "unavailable", "message": "Staff reports unavailable"}), 503


@reports_bp.patch("/api/reports/<int:report_id>/status")
def moderate_report(report_id):
    staff_id = _staff()
    if not staff_id:
        return jsonify({"status": "error", "message": "Staff authorization required"}), 403
    body = request.get_json(silent=True)
    status = body.get("status") if isinstance(body, dict) else None
    if not isinstance(status, str) or status not in STATUSES or status == "unverified":
        return jsonify({"status": "error", "message": "Invalid moderation status"}), 400
    try:
        with get_connection() as conn:
            row = conn.execute("select review_status from public.fire_reports where id=%s for update", (report_id,)).fetchone()
            if row is None:
                return jsonify({"status": "error", "message": "Report not found"}), 404
            previous = row[0]
            if previous == status:
                return jsonify({"status": "success", "data": {"id": report_id, "review_status": status, "unchanged": True}}), 200
            if status not in ALLOWED_TRANSITIONS.get(previous, ()):
                return jsonify({"status": "error", "message": "Invalid status transition"}), 409
            conn.execute("update public.fire_reports set review_status=%s where id=%s", (status, report_id))
            conn.execute(
                "insert into public.fire_report_audit(report_id,old_status,new_status,staff_id) values (%s,%s,%s,%s)",
                (report_id, previous, status, staff_id),
            )
        return jsonify({"status": "success", "data": {"id": report_id, "review_status": status}}), 200
    except Exception:
        current_app.logger.exception("Could not moderate report %s", report_id)
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
        current_app.logger.exception("Could not load report audit %s", report_id)
        return jsonify({"status": "unavailable", "message": "Audit history unavailable"}), 503
