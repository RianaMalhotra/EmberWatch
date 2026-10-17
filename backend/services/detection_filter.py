"""Filter detections by confidence using the configurable threshold (#19)."""

import math

from config import get_min_detection_confidence


def passes_threshold(detection, min_confidence):
    """Return True if a detection's confidence meets the threshold.

    Detections with a missing, non-numeric or non-finite confidence do not pass:
    an unknown confidence is not treated as high (see issue #27).
    """
    confidence = detection.get("confidence") if isinstance(detection, dict) else None
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
        return False
    # NaN and infinity are not real confidence values (infinity would otherwise
    # pass every threshold).
    if not math.isfinite(confidence):
        return False
    return confidence >= min_confidence


def filter_detections(detections, min_confidence=None):
    """Split detections into those that pass and those that don't.

    min_confidence defaults to the configured value from config.py.
    Returns (accepted, rejected) as two lists.
    """
    if min_confidence is None:
        min_confidence = get_min_detection_confidence()

    accepted, rejected = [], []
    for detection in detections:
        (accepted if passes_threshold(detection, min_confidence) else rejected).append(detection)
    return accepted, rejected
