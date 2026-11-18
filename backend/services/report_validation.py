"""Server-side validation for public fire reports (#52).

The Report a Fire form (#51) already checks its input, but the API can be
called directly, so every rule is checked again here. The rules match
buildReportPayload / reportProblems in frontend/src/utils/reportForm.js.
"""

import math
from datetime import datetime, timedelta

LOCATION_SOURCES = ("gps", "map")
OBSERVED_TYPES = ("flames", "smoke", "both")
MAX_DESCRIPTION = 500

# A phone clock can be a little ahead of the server, so allow 5 minutes.
FUTURE_TOLERANCE = timedelta(minutes=5)
# Older sightings are not useful for early detection.
MAX_REPORT_AGE = timedelta(days=7)


def _is_number(value):
    """A finite int/float that is not a bool (JSON true would pass isinstance int)."""
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _parse_timestamp(value):
    """Parse an ISO 8601 string that includes a timezone, or return None."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed


def validate_report(body, now):
    """Check a report body.

    ``now`` must be a timezone-aware datetime (the server's current time).
    Returns ``(report, errors)``: a cleaned dict ready to store and an empty
    list, or ``None`` and a list of problems in plain words.
    """
    if not isinstance(body, dict):
        return None, ["Request body must be a JSON object."]

    errors = []

    latitude = body.get("latitude")
    longitude = body.get("longitude")
    if not (_is_number(latitude) and -90 <= latitude <= 90):
        errors.append("latitude must be a number between -90 and 90.")
    if not (_is_number(longitude) and -180 <= longitude <= 180):
        errors.append("longitude must be a number between -180 and 180.")

    location_source = body.get("location_source")
    if location_source not in LOCATION_SOURCES:
        errors.append("location_source must be 'gps' or 'map'.")

    observed_type = body.get("observed_type")
    if observed_type not in OBSERVED_TYPES:
        errors.append("observed_type must be 'flames', 'smoke' or 'both'.")

    observed_at = _parse_timestamp(body.get("observed_at"))
    if observed_at is None:
        errors.append("observed_at must be an ISO 8601 time with a timezone, e.g. 2026-11-12T18:30:00Z.")
    elif observed_at > now + FUTURE_TOLERANCE:
        errors.append("observed_at cannot be in the future.")
    elif observed_at < now - MAX_REPORT_AGE:
        errors.append("observed_at must be within the last 7 days.")

    description = body.get("description")
    if description is not None:
        if not isinstance(description, str):
            errors.append("description must be text or null.")
        else:
            description = description.strip() or None
            if description is not None and len(description) > MAX_DESCRIPTION:
                errors.append(f"description must be {MAX_DESCRIPTION} characters or fewer.")

    if errors:
        return None, errors

    return {
        "latitude": float(latitude),
        "longitude": float(longitude),
        "location_source": location_source,
        "observed_type": observed_type,
        "observed_at": observed_at,
        "description": description,
    }, []
