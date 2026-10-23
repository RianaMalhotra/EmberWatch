"""Wildfire risk-scoring model (#21).

Combines environmental factors into one 0-100 risk score per area, then maps
it to LOW / MODERATE / HIGH (the levels the map already uses).

How it works
------------
Each factor is turned into a 0-100 "danger" sub-score, where higher means
more fire-prone. The sub-scores are combined with fixed weights:

    factor                  input                        weight
    temperature             temperature_c                0.15
    humidity                relative_humidity_pct        0.20
    wind                    wind_speed_kmh               0.15
    recent rain             precipitation_mm             0.10
    vegetation (fuel)       vegetation_index (NDVI)      0.10
    terrain                 slope_deg                    0.05
    fire history            nearby_detections            0.25

The idea follows fire-danger indices such as Canada's Fire Weather Index
(hot, dry, windy weather after little rain raises danger), plus local fire
history from NASA FIRMS. Weights and ranges are a documented first version
and can be tuned in Sprint 2 ("improve model").

Missing inputs (#24, #28)
-------------------------
Missing values are never filled in with made-up numbers. The score uses the
factors that are available, re-weighted to add up to 1, and the result is
marked incomplete with the list of missing inputs. If the available factors
carry less than MIN_COVERAGE of the total weight, there isn't enough
information, so the score and level are None.
"""

import math

MODEL_VERSION = "weighted-index-v1"

WEIGHTS = {
    "temperature_c": 0.15,
    "relative_humidity_pct": 0.20,
    "wind_speed_kmh": 0.15,
    "precipitation_mm": 0.10,
    "vegetation_index": 0.10,
    "slope_deg": 0.05,
    "nearby_detections": 0.25,
}

# Share of the total weight that must be available to produce a score.
MIN_COVERAGE = 0.5

# Score boundaries for the levels: < 40 LOW, 40-69.9 MODERATE, >= 70 HIGH.
MODERATE_FROM = 40.0
HIGH_FROM = 70.0

# Fire history: detections (confidence >= threshold) within this radius.
HISTORY_RADIUS_KM = 50.0
HISTORY_SATURATION = 1000  # this many or more detections scores 100

VALID_RANGES = {
    "temperature_c": (-60, 60),
    "relative_humidity_pct": (0, 100),
    "wind_speed_kmh": (0, 300),
    "precipitation_mm": (0, 1000),
    "vegetation_index": (-1, 1),
    "slope_deg": (0, 90),
    "nearby_detections": (0, float("inf")),
}


def _scale(value, low, high):
    """Map value linearly to 0-100 between low and high (clamped)."""
    if high == low:
        return 0.0
    return max(0.0, min(100.0, (value - low) / (high - low) * 100.0))


def temperature_score(temperature_c):
    # 5 °C or colder: 0; 35 °C or hotter: 100.
    return _scale(temperature_c, 5, 35)


def humidity_score(relative_humidity_pct):
    # Drier air is more dangerous: 80% RH or more: 0; 15% or less: 100.
    return 100.0 - _scale(relative_humidity_pct, 15, 80)


def wind_score(wind_speed_kmh):
    # Calm: 0; 50 km/h or more: 100.
    return _scale(wind_speed_kmh, 0, 50)


def precipitation_score(precipitation_mm):
    # Recent rain lowers danger: 0 mm: 100; 10 mm or more: 0.
    return 100.0 - _scale(precipitation_mm, 0, 10)


def vegetation_score(vegetation_index):
    # More vegetation means more fuel: NDVI 0.1 or less: 0; 0.7 or more: 100.
    return _scale(vegetation_index, 0.1, 0.7)


def slope_score(slope_deg):
    # Fire spreads faster uphill: flat: 0; 30° or steeper: 100.
    return _scale(slope_deg, 0, 30)


def history_score(nearby_detections):
    # Log scale: 1 -> ~10, 10 -> ~35, 100 -> ~67, 1000+ -> 100.
    return min(100.0, 100.0 * math.log10(1 + nearby_detections) / math.log10(1 + HISTORY_SATURATION))


SCORERS = {
    "temperature_c": temperature_score,
    "relative_humidity_pct": humidity_score,
    "wind_speed_kmh": wind_score,
    "precipitation_mm": precipitation_score,
    "vegetation_index": vegetation_score,
    "slope_deg": slope_score,
    "nearby_detections": history_score,
}


def risk_level(score):
    if score is None:
        return None
    if score >= HIGH_FROM:
        return "HIGH"
    if score >= MODERATE_FROM:
        return "MODERATE"
    return "LOW"


def _usable(name, value):
    """True if the value is a real number inside the valid range."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    if isinstance(value, float) and math.isnan(value):
        return False
    low, high = VALID_RANGES[name]
    return low <= value <= high


def score_area(inputs):
    """Score one area.

    ``inputs`` is a dict with any of the keys in WEIGHTS. Missing, None or
    out-of-range values count as missing.

    Returns a dict:
        risk_score      0-100 (one decimal) or None if not enough data
        risk_level      "LOW" / "MODERATE" / "HIGH" or None
        is_complete     True only if every input was available
        missing_inputs  list of input names that were missing or invalid
        coverage        share of the total weight that was available (0-1)
        factor_scores   each available factor's 0-100 sub-score
        model_version   which version of the model produced this
    """
    inputs = inputs or {}
    factor_scores, missing = {}, []
    for name, scorer in SCORERS.items():
        value = inputs.get(name)
        if _usable(name, value):
            factor_scores[name] = round(scorer(value), 1)
        else:
            missing.append(name)

    coverage = sum(WEIGHTS[name] for name in factor_scores)
    if coverage + 1e-9 < MIN_COVERAGE:
        score = None
    else:
        score = round(sum(WEIGHTS[n] * s for n, s in factor_scores.items()) / coverage, 1)

    return {
        "risk_score": score,
        "risk_level": risk_level(score),
        "is_complete": not missing,
        "missing_inputs": missing,
        "coverage": round(coverage, 2),
        "factor_scores": factor_scores,
        "model_version": MODEL_VERSION,
    }


# ---------------------------------------------------------------------------
# Database helpers (Supabase)
# ---------------------------------------------------------------------------

NEARBY_DETECTIONS_SQL = """
    select count(*)
    from public.detections
    where confidence >= %(min_confidence)s
      and extensions.st_dwithin(
            location,
            extensions.st_setsrid(extensions.st_makepoint(%(lon)s, %(lat)s), 4326)::extensions.geography,
            %(radius_m)s)
"""

SAVE_ASSESSMENT_SQL = """
    insert into public.risk_assessments
        (area_id, risk_score, risk_level, is_complete, missing_inputs, model_version)
    values (%s, %s, %s, %s, %s, %s)
    returning id
"""

LATEST_AREA_ENVIRONMENT_SQL = """
SELECT
    a.id,
    a.name,
    a.latitude,
    a.longitude,
    a.slope_deg,
    eo.temperature_c,
    eo.relative_humidity_pct,
    eo.wind_speed_kmh,
    eo.precipitation_mm,
    eo.vegetation_index,
    eo.observed_at
FROM public.areas AS a
LEFT JOIN LATERAL (
    SELECT
        temperature_c,
        relative_humidity_pct,
        wind_speed_kmh,
        precipitation_mm,
        vegetation_index,
        observed_at
    FROM public.environmental_observations AS eo
    WHERE eo.area_id = a.id
    ORDER BY eo.observed_at DESC
    LIMIT 1
) AS eo ON true
ORDER BY a.id;
"""

def count_nearby_detections(conn, latitude, longitude, radius_km=HISTORY_RADIUS_KM, min_confidence=None):
    """Count past FIRMS detections near a point (uses the #19 threshold)."""
    if min_confidence is None:
        from config import get_min_detection_confidence
        min_confidence = get_min_detection_confidence()
    with conn.cursor() as cur:
        cur.execute(NEARBY_DETECTIONS_SQL, {
            "lat": latitude, "lon": longitude,
            "radius_m": radius_km * 1000, "min_confidence": min_confidence,
        })
        return cur.fetchone()[0]


def save_assessment(conn, area_id, result):
    """Store a score_area() result in risk_assessments. Returns the new row id."""
    with conn.cursor() as cur:
        cur.execute(SAVE_ASSESSMENT_SQL, (
            area_id, result["risk_score"], result["risk_level"], result["is_complete"],
            result["missing_inputs"], result["model_version"],
        ))
        new_id = cur.fetchone()[0]
    conn.commit()
    return new_id

def get_area_environmental_data(conn):
    """Return each monitored area with its latest environmental observation."""
    rows = conn.execute(LATEST_AREA_ENVIRONMENT_SQL).fetchall()

    return [
        {
            "id": row[0],
            "name": row[1],
            "latitude": row[2],
            "longitude": row[3],
            "slope_deg": row[4],
            "temperature_c": row[5],
            "relative_humidity_pct": row[6],
            "wind_speed_kmh": row[7],
            "precipitation_mm": row[8],
            "vegetation_index": row[9],
            "observed_at": row[10],
        }
        for row in rows
    ]