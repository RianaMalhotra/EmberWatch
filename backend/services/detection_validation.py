import math
from datetime import datetime

def validate_detection(data):
    if not isinstance(data, dict):
        return False, "Detection data is unavailable"

    required = ["latitude", "longitude", "timestamp"]

    for field in required:
        if field not in data or data[field] is None:
            return False, f"Missing required field: {field}"

    lat = data["latitude"]
    lon = data["longitude"]

    if (
        isinstance(lat, bool)
        or isinstance(lon, bool)
        or not isinstance(lat, (int, float))
        or not isinstance(lon, (int, float))
        or not math.isfinite(lat)
        or not math.isfinite(lon)
        or not -90 <= lat <= 90
        or not -180 <= lon <= 180
    ):
        return False, "Invalid coordinates"

    try:
        datetime.fromisoformat(data["timestamp"].replace("Z", "+00:00"))
    except (ValueError, TypeError, AttributeError):
        return False, "Invalid timestamp"

    return True, None