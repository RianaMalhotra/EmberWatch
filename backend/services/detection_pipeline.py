"""Wildfire detection classification pipeline (#17).

Turns raw FIRMS rows from the ``detections`` table into the records the map
shows (#18). It reuses the earlier building blocks instead of redoing them:

    raw row  ->  validate_detection (#27)   location + time must be usable
             ->  passes_threshold   (#19)   confidence vs. the configurable threshold
             ->  classified record          location, timestamp, confidence, class

Rules (from the #10 acceptance criteria):

* Every detection gets a classification: ``potential_wildfire`` when its
  confidence meets the threshold, otherwise ``low_confidence``. Low-confidence
  detections are kept (not dropped) so the map can show them differently.
* A row with a missing/invalid location, time or confidence is never
  fabricated or guessed: it is left out of ``detections`` and reported in
  ``gaps`` with the reason.
* The threshold comes from config.py (``MIN_DETECTION_CONFIDENCE``), never a
  hardcoded number here.
"""

import math
from datetime import datetime, timezone

from config import get_min_detection_confidence
from services.detection_filter import passes_threshold
from services.detection_validation import validate_detection

POTENTIAL_WILDFIRE = "potential_wildfire"
LOW_CONFIDENCE = "low_confidence"

DEFAULT_LIMIT = 200
MAX_LIMIT = 1000

# Columns the pipeline needs, in the order the SQL below returns them.
DETECTION_COLUMNS = (
    "id", "latitude", "longitude", "detected_at", "confidence",
    "confidence_class", "instrument", "satellite", "frp",
)

# Newest first. Parameterised so the limit can never be injected.
RECENT_DETECTIONS_SQL = """
    select id, latitude, longitude, detected_at, confidence,
           confidence_class, instrument, satellite, frp
    from public.detections
    order by detected_at desc
    limit %(limit)s
"""


def _timestamp_text(value):
    """Return the detection time as an ISO-8601 UTC string, or None.

    psycopg returns ``timestamptz`` columns as ``datetime`` objects, but
    validate_detection (#27) expects the ISO text form that the API sends out.
    A time without a zone is read as UTC, which is what FIRMS provides.
    """
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return value if isinstance(value, str) else None


def _finite_or_none(value):
    """Return a finite number, else None (NaN/inf would also break the JSON response)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return value


def classify_detection(row, min_confidence=None):
    """Classify one raw detection row.

    ``row`` is a dict with the ``detections`` table's column names.
    Returns ``(record, None)`` for a usable detection or ``(None, reason)``
    when it can't be shown without making something up.
    """
    if not isinstance(row, dict):
        return None, "Detection data is unavailable"
    if min_confidence is None:
        min_confidence = get_min_detection_confidence()

    timestamp = _timestamp_text(row.get("detected_at"))
    valid, reason = validate_detection({
        "latitude": row.get("latitude"),
        "longitude": row.get("longitude"),
        "timestamp": timestamp,
    })
    if not valid:
        return None, reason

    confidence = row.get("confidence")
    # An unknown confidence is never treated as high (same rule as #19/#27).
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
        return None, "Missing confidence"
    # NaN and infinity are rejected here, not just by the range check below.
    if not math.isfinite(confidence) or not 0 <= confidence <= 100:
        return None, "Invalid confidence"

    meets = passes_threshold({"confidence": confidence}, min_confidence)
    return {
        "id": row.get("id"),
        "latitude": row["latitude"],
        "longitude": row["longitude"],
        "timestamp": timestamp,
        "confidence": confidence,
        "confidence_class": row.get("confidence_class"),
        "classification": POTENTIAL_WILDFIRE if meets else LOW_CONFIDENCE,
        "meets_threshold": meets,
        "satellite": row.get("satellite"),
        "instrument": row.get("instrument"),
        # FRP may be NULL in the source data; it stays None, never a made-up 0.
        "frp": _finite_or_none(row.get("frp")),
    }, None


def classify_detections(rows, min_confidence=None):
    """Classify many rows. Returns a result dict ready for the API.

    ``detections``  usable records, in the order given
    ``gaps``        one ``{"id", "reason"}`` per row that was left out
    ``threshold``   the confidence threshold that was applied
    ``counts``      totals so the UI can say "3 of 200 could not be shown"
    """
    if min_confidence is None:
        min_confidence = get_min_detection_confidence()

    detections, gaps = [], []
    for row in rows:
        record, reason = classify_detection(row, min_confidence)
        if record is None:
            gaps.append({"id": row.get("id") if isinstance(row, dict) else None, "reason": reason})
        else:
            detections.append(record)

    likely = sum(1 for d in detections if d["meets_threshold"])
    return {
        "detections": detections,
        "gaps": gaps,
        "threshold": min_confidence,
        "counts": {
            "total": len(detections) + len(gaps),
            "shown": len(detections),
            "potential_wildfire": likely,
            "low_confidence": len(detections) - likely,
            "unavailable": len(gaps),
        },
    }


def clamp_limit(value, default=DEFAULT_LIMIT, maximum=MAX_LIMIT):
    """Parse a ``?limit=`` value into 1..maximum, falling back to default."""
    try:
        limit = int(value)
    except (TypeError, ValueError):
        return default
    return max(1, min(limit, maximum))


def fetch_recent_detections(conn, limit=DEFAULT_LIMIT):
    """Read the newest detections from Supabase as a list of dicts."""
    with conn.cursor() as cur:
        cur.execute(RECENT_DETECTIONS_SQL, {"limit": clamp_limit(limit)})
        return [dict(zip(DETECTION_COLUMNS, row)) for row in cur.fetchall()]


def get_classified_detections(conn, limit=DEFAULT_LIMIT, min_confidence=None):
    """Fetch the newest detections and classify them (used by the API route)."""
    return classify_detections(fetch_recent_detections(conn, limit), min_confidence)
