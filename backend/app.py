from flask import Flask, jsonify, request
from flask_cors import CORS

from config import get_cors_origins
from db import check_database, get_connection
from services.detection_pipeline import get_classified_detections
from services.risk_scoring import count_nearby_detections, score_area

app = Flask(__name__)
CORS(app, resources={
    r"/api/*": {"origins": get_cors_origins()}
})


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
            inputs["nearby_detections"] = None

    return jsonify({"status": "success", "data": score_area(inputs)}), 200

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
        return jsonify({"status": "error", "message": str(error)}), 500
    except Exception:
        # Don't leak connection details; the frontend only needs "unavailable".
        return jsonify({"status": "unavailable", "message": "Detection data is unavailable"}), 503

    return jsonify({"status": "success", "source": "database", **result}), 200


@app.route("/api/risk-areas", methods=["GET"])
def get_risk_areas():
    risk_areas = [
        {
            "id": 1,
            "latitude": 45.42,
            "longitude": -75.69,
            "risk_level": "HIGH"
        },
        {
            "id": 2,
            "latitude": 45.60,
            "longitude": -78.40,
            "risk_level": "MODERATE"
        },
        {
            "id": 3,
            "latitude": 44.20,
            "longitude": -79.10,
            "risk_level": "LOW"
        }
    ]

    return jsonify({
        "status": "success",
        "source": "mock",
        "data": risk_areas
    }), 200
    
if __name__ == "__main__":
    app.run(debug=True, port=5000)