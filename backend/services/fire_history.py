"""Unified historical fire records from FIRMS detections and confirmed reports."""
from services.detection_history import history_params


HISTORICAL_FIRES_SQL = """
    WITH historical_events AS (
        -- NASA FIRMS satellite detections
        SELECT
            d.id,
            'satellite_detection'::text AS event_type,
            d.latitude,
            d.longitude,
            d.detected_at AS event_at,
            d.created_at AS submitted_at,
            d.source,
            d.confidence,
            d.confidence_class,
            d.instrument,
            d.satellite,
            d.frp,
            NULL::text AS review_status,
            NULL::timestamptz AS ended_at,
            NULL::bigint AS linked_report_id,
            NULL::bigint AS linked_detection_id,
            NULL::text AS location_source
        FROM public.detections d
        WHERE d.latitude BETWEEN %(south)s AND %(north)s
          AND d.longitude BETWEEN %(west)s AND %(east)s
          AND d.detected_at >= %(start)s
          AND d.detected_at < %(end)s

        UNION ALL

        -- Confirmed community reports and their public lifecycle fields
        SELECT
            r.id,
            'community_report'::text AS event_type,
            r.latitude,
            r.longitude,
            r.observed_at AS event_at,
            r.created_at AS submitted_at,
            r.source,
            NULL::double precision AS confidence,
            NULL::text AS confidence_class,
            NULL::text AS instrument,
            NULL::text AS satellite,
            NULL::double precision AS frp,
            r.review_status,
            r.ended_at,
            r.linked_report_id,
            r.linked_detection_id,
            r.location_source
        FROM public.fire_reports r
        WHERE r.latitude BETWEEN %(south)s AND %(north)s
          AND r.longitude BETWEEN %(west)s AND %(east)s
          AND r.observed_at >= %(start)s
          AND r.observed_at < %(end)s
          AND r.review_status IN (
              'confirmed',
              'out_of_control',
              'being_held',
              'under_control',
              'out'
          )
    )
    SELECT *
    FROM historical_events
    ORDER BY event_at DESC, id DESC
    LIMIT %(limit)s
"""


RECORD_COLUMNS = (
    "id", "event_type", "latitude", "longitude", "event_at",
    "submitted_at", "source", "confidence", "confidence_class",
    "instrument", "satellite", "frp", "review_status", "ended_at",
    "linked_report_id", "linked_detection_id", "location_source",
)


def get_historical_fire_records(conn, args):
    """Return bounded historical satellite and confirmed-report records."""
    params = history_params(args)

    with conn.cursor() as cur:
        cur.execute(
            HISTORICAL_FIRES_SQL,
            {**params, "limit": params["limit"] + 1},
        )
        fetched = cur.fetchall()

    truncated = len(fetched) > params["limit"]
    records = [
        dict(zip(RECORD_COLUMNS, row))
        for row in fetched[:params["limit"]]
    ]

    # Approximate community-report coordinates, matching the public report API.
    for record in records:
        if record["event_type"] == "community_report":
            record["latitude"] = round(float(record["latitude"]), 2)
            record["longitude"] = round(float(record["longitude"]), 2)

    return {
        "truncated": truncated,
        "filters": {
            "south": params["south"],
            "north": params["north"],
            "west": params["west"],
            "east": params["east"],
            "start": params["start"].isoformat().replace("+00:00", "Z"),
            "end": params["end"].isoformat().replace("+00:00", "Z"),
            "limit": params["limit"],
        },
        "data": records,
    }