"""Central configuration for the Flask backend.

Values can be overridden with environment variables so they are never
hardcoded in the detection logic (issue #19).
"""

import os

# Minimum FIRMS confidence (0-100) for a detection to be shown as a
# likely wildfire. Detections below this value are filtered out.
#
# 20 comes from the backtest in ml/backtest_threshold.py on MODIS data for
# Canada, 2023-2025 (recommended 20, 20, 15): it keeps ~90% of persistent
# fires. Confidence alone separates real fires from one-off hotspots only
# weakly, so treat this as provisional. See docs/threshold-backtest.md.
DEFAULT_MIN_DETECTION_CONFIDENCE = 20.0


def get_min_detection_confidence():
    """Return the configured threshold, falling back to the default.

    Set MIN_DETECTION_CONFIDENCE in the environment to override it, e.g.
    ``MIN_DETECTION_CONFIDENCE=50 python app.py``.
    """
    raw = os.environ.get("MIN_DETECTION_CONFIDENCE")
    if raw is None or raw.strip() == "":
        return DEFAULT_MIN_DETECTION_CONFIDENCE

    try:
        value = float(raw)
    except ValueError:
        raise ValueError(f"MIN_DETECTION_CONFIDENCE must be a number, got {raw!r}")

    if not 0 <= value <= 100:
        raise ValueError(f"MIN_DETECTION_CONFIDENCE must be between 0 and 100, got {value}")
    return value


# Browser origins allowed to call the API (CORS). The default is the local Vite
# dev server. For a deployment, set CORS_ORIGINS to the site's address, e.g.
# ``CORS_ORIGINS=https://ash-detectives.example.com`` (comma-separate several).
DEFAULT_CORS_ORIGINS = ["http://localhost:5173"]


def get_cors_origins():
    """Return the allowed origins from CORS_ORIGINS, or the local default."""
    raw = os.environ.get("CORS_ORIGINS")
    if raw is None:
        return list(DEFAULT_CORS_ORIGINS)
    origins = [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]
    return origins or list(DEFAULT_CORS_ORIGINS)
