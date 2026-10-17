from flask import Flask, jsonify, request
from flask_cors import CORS

from db import check_database, get_connection
from services.risk_scoring import count_nearby_detections, score_area, get_area_environmental_data

app = Flask(__name__)
CORS(app, resources={
    r"/api/*": {"origins": "http://localhost:5173"}
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

@app.route("/api/risk-areas", methods=["GET"])
def get_risk_areas():
    try:
        with get_connection() as conn:
            areas = get_area_environmental_data(conn)

            results = []

            for area in areas:
                nearby_detections = count_nearby_detections(
                    conn,
                    area["latitude"],
                    area["longitude"],
                )

                inputs = {
                    "temperature_c": area["temperature_c"],
                    "relative_humidity_pct": area["relative_humidity_pct"],
                    "wind_speed_kmh": area["wind_speed_kmh"],
                    "precipitation_mm": area["precipitation_mm"],
                    "vegetation_index": area["vegetation_index"],
                    "slope_deg": None,
                    "nearby_detections": nearby_detections,
                }

                risk = score_area(inputs)

                results.append({
                    "id": area["id"],
                    "name": area["name"],
                    "latitude": area["latitude"],
                    "longitude": area["longitude"],

                    "risk_score": risk["risk_score"],
                    "risk_level": risk["risk_level"],
                    "is_complete": risk["is_complete"],
                    "missing_inputs": risk["missing_inputs"],
                    "coverage": risk["coverage"],
                    "factor_scores": risk["factor_scores"],
                    "model_version": risk["model_version"],

                    "environmental_factors": {
                        "temperature_c": area["temperature_c"],
                        "relative_humidity_pct": area["relative_humidity_pct"],
                        "wind_speed_kmh": area["wind_speed_kmh"],
                        "precipitation_mm": area["precipitation_mm"],
                        "vegetation_index": area["vegetation_index"],
                        "slope_deg": None,
                        "nearby_detections": nearby_detections,
                    },

                    "observed_at": area["observed_at"],
                })

            return jsonify({
                "status": "success",
                "source": "supabase",
                "data": results,
            }), 200

    except Exception as error:
        print("ERROR in /api/risk-areas:", repr(error))

        return jsonify({
            "status": "error",
            "message": str(error),
        }), 503
    
if __name__ == "__main__":
    app.run(debug=True, port=5000)