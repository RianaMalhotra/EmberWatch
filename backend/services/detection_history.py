"""Bounded historical FIRMS detection queries for Sprint 3 (#46).

Coordinates are WGS84 decimal degrees; timestamps are timezone-aware ISO-8601.
The API does not infer missing dates or silently expand a requested region.
"""
from datetime import datetime, timezone

from services.detection_pipeline import DETECTION_COLUMNS, clamp_limit, classify_detections

HISTORY_SQL = """
    select id, latitude, longitude, detected_at, confidence,
           confidence_class, instrument, satellite, frp
    from public.detections
    where latitude between %(south)s and %(north)s
      and longitude between %(west)s and %(east)s
      and detected_at >= %(start)s and detected_at < %(end)s
    order by detected_at desc, id desc
    limit %(limit)s
"""


def parse_utc_timestamp(raw):
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("start and end must be ISO-8601 timestamps with a timezone")
    try:
        value = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("Invalid ISO-8601 timestamp") from error
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Timestamps must include a timezone")
    return value.astimezone(timezone.utc)


def history_params(args):
    try:
        south, north, west, east = (float(args[key]) for key in ("south", "north", "west", "east"))
    except (KeyError, ValueError, TypeError) as error:
        raise ValueError("Provide numeric south, north, west and east bounds") from error
    import math
    if not all(math.isfinite(v) for v in (south, north, west, east)):
        raise ValueError("Region bounds must be finite")
    if not (-90 <= south <= north <= 90 and -180 <= west <= east <= 180):
        raise ValueError("Invalid region bounds; antimeridian-crossing boxes are not supported")
    start, end = parse_utc_timestamp(args.get("start")), parse_utc_timestamp(args.get("end"))
    if start >= end:
        raise ValueError("start must be earlier than end")
    return dict(south=south, north=north, west=west, east=east,
                start=start, end=end, limit=clamp_limit(args.get("limit")))


def get_historical_detections(conn, args, min_confidence=None):
    params = history_params(args)
    with conn.cursor() as cur:
        cur.execute(HISTORY_SQL, {**params, "limit": params["limit"] + 1})
        fetched = cur.fetchall()
        truncated = len(fetched) > params["limit"]
        rows = [dict(zip(DETECTION_COLUMNS, row)) for row in fetched[:params["limit"]]]
    result = classify_detections(rows, min_confidence)
    return {"truncated": truncated, "filters": {
        "south": params["south"], "north": params["north"],
        "west": params["west"], "east": params["east"],
        "start": params["start"].isoformat().replace("+00:00", "Z"),
        "end": params["end"].isoformat().replace("+00:00", "Z"),
        "limit": params["limit"],
    }, **result}
