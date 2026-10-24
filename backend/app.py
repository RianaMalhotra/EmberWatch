import math

from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from config import get_cors_origins
from db import check_database, get_connection

from services.risk_scoring import (
    MODEL_VERSION,
    count_nearby_detections,
    get_area_environmental_data,
    score_area,
)
from services.detection_pipeline import get_classified_detections

app = Flask(__name__)
CORS(app, resources={
    r"/api/*": {"origins": get_cors_origins()}
})


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    """Last line of defence (#26): API clients always get JSON, never an HTML
    error page or a stack trace. Details go to the server log only."""
    if isinstance(error, HTTPException):
        # 404, 405, ... keep their own status code.
        if request.path.startswith("/api/"):
            return jsonify({"status": "error", "message": error.name}), error.code
        return error
    app.logger.exception("Unhandled error on %s %s", request.method, request.path)
    return jsonify({"status": "error", "message": "Unexpected server error"}), 500


@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "ok",
        "message": "Wildfire Detection API is running"
    }), 200

@app.route("/api/health/db", methods=["GET"])
def database_health_check():
    ok, reason = check_database()
    if ok:
        return jsonify({"status": "ok", "message": "Database is reachable"}), 200
    return jsonify({"status": "unavailable", "message": reason}), 503

@app.route("/api/risk-score", methods=["POST"])
def risk_score():
    """Score one area from environmental inputs (#21).

    JSON body: any of temperature_c, relative_humidity_pct, wind_speed_kmh,
    precipitation_mm, vegetation_index, slope_deg, nearby_detections.
    If latitude/longitude are given and nearby_detections is not, the fire
    history is counted from the detections table. If the database can't be
    reached, history is treated as a missing input instead of failing.
    """
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"status": "error", "message": "Request body must be a JSON object"}), 400

    inputs = dict(body)
    lat, lon = body.get("latitude"), body.get("longitude")
    has_location = (
        all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (lat, lon))
        and -90 <= lat <= 90 and -180 <= lon <= 180
    )
    if inputs.get("nearby_detections") is None and has_location:
        try:
            with get_connection() as conn:
                inputs["nearby_detections"] = count_nearby_detections(conn, lat, lon)
        except Exception:
            app.logger.warning("Fire history unavailable for /api/risk-score", exc_info=True)
            inputs["nearby_detections"] = None

    try:
        result = score_area(inputs)
    except Exception:
        # #26: a model failure is reported, not shown as a score or a stack trace.
        app.logger.exception("Risk model failed in /api/risk-score")
        return jsonify({"status": "error", "message": "Risk score could not be calculated"}), 500

    return jsonify({"status": "success", "data": result}), 200

@app.route("/api/detections", methods=["GET"])
def get_detections():
    """Classified wildfire detections for the map (#17, #18).

    Query: ?limit=N (1-1000, default 200), newest detections first.
    Each record has location, timestamp (UTC), confidence and a classification
    (potential_wildfire / low_confidence). Rows with missing or invalid data
    are listed under "gaps" instead of being shown with made-up values.
    If the database can't be reached the answer is 503 with no data, so the
    map shows an error rather than invented detections.
    """
    try:
        with get_connection() as conn:
            result = get_classified_detections(conn, request.args.get("limit"))
    except ValueError as error:
        # Bad MIN_DETECTION_CONFIDENCE in the environment (see config.py).
        app.logger.error("Invalid detection configuration: %s", error)
        return jsonify({"status": "error", "message": str(error)}), 500
    except Exception:
        # Don't leak connection details; the frontend only needs "unavailable".
        app.logger.exception("Could not load detections")
        return jsonify({"status": "unavailable", "message": "Detection data is unavailable"}), 503

    return jsonify({"status": "success", "source": "database", **result}), 200


def _is_coordinate(value):
    """A finite number (not bool/NaN/inf), so the map can draw the area."""
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _environmental_factors(area, nearby_detections):
    return {
        "temperature_c": area.get("temperature_c"),
        "relative_humidity_pct": area.get("relative_humidity_pct"),
        "wind_speed_kmh": area.get("wind_speed_kmh"),
        "precipitation_mm": area.get("precipitation_mm"),
        "vegetation_index": area.get("vegetation_index"),
        "slope_deg": area.get("slope_deg"),
        "nearby_detections": nearby_detections,
    }


def _unscored_risk():
    """Shown when the model fails for one area (#26): no score is invented."""
    return {
        "risk_score": None,
        "risk_level": None,
        "is_complete": False,
        "missing_inputs": [],  # the inputs are present; it is the model that failed
        "coverage": 0,
        "factor_scores": {},
        "model_version": MODEL_VERSION,
    }


def _risk_area_record(area, nearby_detections, risk, processing_error=False):
    record = {
        "id": area.get("id"),
        "name": area.get("name"),
        "latitude": area.get("latitude"),
        "longitude": area.get("longitude"),

        "risk_score": risk["risk_score"],
        "risk_level": risk["risk_level"],
        "is_complete": risk["is_complete"],
        "missing_inputs": risk["missing_inputs"],
        "coverage": risk["coverage"],
        "factor_scores": risk["factor_scores"],
        "model_version": risk["model_version"],

        "environmental_factors": _environmental_factors(area, nearby_detections),

        "observed_at": area.get("observed_at"),
    }
    if processing_error:
        record["processing_error"] = True
    return record


def _build_risk_areas(conn, areas):
    """Score every area, degrading instead of failing (#25, #26).

    Returns ``(results, warnings)``. One problem never takes the whole map down:

    * Fire-history lookup fails (database/PostGIS problem): history becomes a
      missing input for every area, so scores are marked incomplete, and later
      areas skip the lookup instead of waiting on a broken connection again.
    * An area has no usable location: it is left out and counted in a warning.
    * The model raises for one area: that area is returned as "risk
      unavailable" and the rest are still scored.
    """
    results = []
    history_available = True
    skipped = 0
    scoring_failed = 0

    for area in areas:
        if not (_is_coordinate(area.get("latitude")) and _is_coordinate(area.get("longitude"))):
            skipped += 1
            continue

        nearby_detections = None
        if history_available:
            try:
                nearby_detections = count_nearby_detections(
                    conn, area["latitude"], area["longitude"]
                )
            except Exception:
                app.logger.exception("Fire history lookup failed; scoring without it")
                history_available = False

        try:
            risk = score_area({
                "temperature_c": area.get("temperature_c"),
                "relative_humidity_pct": area.get("relative_humidity_pct"),
                "wind_speed_kmh": area.get("wind_speed_kmh"),
                "precipitation_mm": area.get("precipitation_mm"),
                "vegetation_index": area.get("vegetation_index"),
                "slope_deg": area.get("slope_deg"),
                "nearby_detections": nearby_detections,
            })
            results.append(_risk_area_record(area, nearby_detections, risk))
        except Exception:
            app.logger.exception("Risk model failed for area %s", area.get("id"))
            scoring_failed += 1
            results.append(_risk_area_record(
                area, nearby_detections, _unscored_risk(), processing_error=True
            ))

    warnings = []
    if not history_available:
        warnings.append({
            "code": "history_unavailable",
            "message": "Nearby fire history is temporarily unavailable, "
                       "so risk scores are incomplete.",
        })
    if scoring_failed:
        warnings.append({
            "code": "scoring_failed",
            "count": scoring_failed,
            "message": f"Risk could not be calculated for {scoring_failed} area(s).",
        })
    if skipped:
        warnings.append({
            "code": "area_skipped",
            "count": skipped,
            "message": f"{skipped} area(s) were left out because their location is missing or invalid.",
        })
    return results, warnings


@app.route("/api/risk-areas", methods=["GET"])
def get_risk_areas():
    """Risk for every monitored area (#22, #23).

    If the database can't be reached or the area query fails there is nothing
    to show, so the answer is 503 (no invented data). Smaller problems (fire
    history unavailable, one area that can't be scored) still return 200 with
    the areas that work plus a ``warnings`` list the UI can show (#25, #26).
    """
    results = warnings = None
    try:
        with get_connection() as conn:
            areas = get_area_environmental_data(conn)
            results, warnings = _build_risk_areas(conn, areas)
    except Exception:
        app.logger.exception("Could not load risk areas")
        # If only closing the connection failed after the data was gathered,
        # the results are still good, so serve them.
        if results is None:
            return jsonify({
                "status": "error",
                "message": "Unable to retrieve wildfire risk data",
            }), 503

    body = {
        "status": "success",
        "source": "supabase",
        "data": results,
    }
    if warnings:
        body["warnings"] = warnings
    return jsonify(body), 200


if __name__ == "__main__":
    app.run(debug=True, port=5000)