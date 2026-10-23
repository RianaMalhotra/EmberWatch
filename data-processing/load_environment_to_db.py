"""Populate the `areas` and `environmental_observations` tables (issue #68).

Areas come from data-processing/areas.csv (each row says why the area was
chosen). Weather and terrain come from Open-Meteo, which is free and needs
no API key. See docs/environmental-data.md for sources and units.

Run from the repository root:

    python data-processing/load_environment_to_db.py --dry-run          # print only
    python data-processing/load_environment_to_db.py                    # yesterday
    python data-processing/load_environment_to_db.py --date 2026-08-15 --days 3

What gets stored, per area and day (Fire Weather Index convention):
- temperature, relative humidity and wind speed at 12:00 local time
- precipitation summed over the 24 hours ending at 12:00 local time
- vegetation_index stays NULL: there is no NDVI source yet, so the risk model
  reports it as a missing input instead of using a made-up value (#27, #28)

Slope (from five elevation samples around the area centre) is stored once per
area in `areas.slope_deg`. Values outside the allowed range are stored as NULL
with a warning. Re-running is safe: existing observations are skipped.
"""

import argparse
import csv
import json
import math
import os
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
AREAS_CSV = os.path.join(HERE, "areas.csv")

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ELEVATION_URL = "https://api.open-meteo.com/v1/elevation"
HOURLY_VARIABLES = "temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation"

# The archive (ERA5) lags real time by about 5 days; newer days use the forecast API.
ARCHIVE_DELAY_DAYS = 6
SLOPE_SAMPLE_DISTANCE_M = 250.0
METRES_PER_DEGREE_LAT = 111320.0
TERRAIN_SOURCE = "open-meteo-elevation (Copernicus DEM GLO-90)"

# Same limits as the CHECK constraints in the schema, plus a sanity range for temperature.
VALID_RANGES = {
    "temperature_c": (-60.0, 60.0),
    "relative_humidity_pct": (0.0, 100.0),
    "wind_speed_kmh": (0.0, 400.0),
    "precipitation_mm": (0.0, 500.0),
    "slope_deg": (0.0, 90.0),
}

UPSERT_AREA_SQL = """
    insert into public.areas (name, province, latitude, longitude)
    values (%s, %s, %s, %s)
    on conflict (name) do update
        set province = excluded.province,
            latitude = excluded.latitude,
            longitude = excluded.longitude
"""

AREA_IDS_SQL = "select id, name from public.areas where name = any(%s)"

UPDATE_TERRAIN_SQL = """
    update public.areas
    set elevation_m = %s, slope_deg = %s, terrain_source = %s, terrain_retrieved_at = %s
    where id = %s
"""

INSERT_OBSERVATION_SQL = """
    insert into public.environmental_observations
        (area_id, observed_at, temperature_c, relative_humidity_pct,
         wind_speed_kmh, precipitation_mm, vegetation_index, source)
    values (%s, %s, %s, %s, %s, %s, %s, %s)
    on conflict (area_id, observed_at, source) do nothing
"""


def warn(message):
    print(f"WARNING: {message}", file=sys.stderr)


# ---------- areas ----------

def load_areas(path=AREAS_CSV):
    """Read areas.csv into dicts with numeric coordinates."""
    with open(path, newline="", encoding="utf-8") as source:
        areas = []
        for row in csv.DictReader(source):
            lat, lon = float(row["latitude"]), float(row["longitude"])
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise ValueError(f"Bad coordinates for {row['name']}: {lat}, {lon}")
            areas.append({"name": row["name"].strip(), "province": row["province"].strip(),
                          "latitude": lat, "longitude": lon})
    return areas


# ---------- validation ----------

def checked(field, value, label=""):
    """Return value if it is a number inside its allowed range, else None (+ warning)."""
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        warn(f"{label}{field}={value!r} is not a number; stored as NULL")
        return None
    low, high = VALID_RANGES[field]
    if math.isnan(number) or not (low <= number <= high):
        warn(f"{label}{field}={number} is outside {low}..{high}; stored as NULL")
        return None
    return number


# ---------- terrain ----------

def terrain_points(lat, lon, distance_m=SLOPE_SAMPLE_DISTANCE_M):
    """Centre, north, south, east and west points `distance_m` metres apart."""
    dlat = distance_m / METRES_PER_DEGREE_LAT
    dlon = distance_m / (METRES_PER_DEGREE_LAT * math.cos(math.radians(lat)))
    return [(lat, lon), (lat + dlat, lon), (lat - dlat, lon), (lat, lon + dlon), (lat, lon - dlon)]


def slope_from_elevations(centre, north, south, east, west, distance_m=SLOPE_SAMPLE_DISTANCE_M):
    """Slope in degrees using central differences. None if any sample is missing."""
    samples = (centre, north, south, east, west)
    if any(v is None or (isinstance(v, float) and math.isnan(v)) for v in samples):
        return None
    dz_dx = (east - west) / (2 * distance_m)
    dz_dy = (north - south) / (2 * distance_m)
    return math.degrees(math.atan(math.hypot(dz_dx, dz_dy)))


def elevation_url(points):
    """One Open-Meteo elevation request for up to 100 points."""
    if len(points) > 100:
        raise ValueError("Open-Meteo elevation accepts at most 100 points per request")
    query = {
        "latitude": ",".join(f"{lat:.5f}" for lat, _ in points),
        "longitude": ",".join(f"{lon:.5f}" for _, lon in points),
    }
    return f"{ELEVATION_URL}?{urllib.parse.urlencode(query, safe=',')}"


def terrain_rows(areas, elevations, retrieved_at):
    """Turn the elevation list (5 values per area, same order) into terrain dicts."""
    if len(elevations) != 5 * len(areas):
        raise ValueError(f"Expected {5 * len(areas)} elevations, got {len(elevations)}")
    rows = []
    for i, area in enumerate(areas):
        centre, north, south, east, west = elevations[5 * i:5 * i + 5]
        slope = slope_from_elevations(centre, north, south, east, west)
        rows.append({
            "name": area["name"],
            "elevation_m": None if centre is None else float(centre),
            "slope_deg": checked("slope_deg", slope, f"{area['name']}: "),
            "terrain_source": TERRAIN_SOURCE,
            "terrain_retrieved_at": retrieved_at,
        })
    return rows


# ---------- weather ----------

def weather_request(area, day, today):
    """URL and source label for the hours needed to describe `day` at noon."""
    use_archive = (today - day).days >= ARCHIVE_DELAY_DAYS
    query = {
        "latitude": f"{area['latitude']:.4f}",
        "longitude": f"{area['longitude']:.4f}",
        "hourly": HOURLY_VARIABLES,
        "start_date": (day - timedelta(days=1)).isoformat(),  # for the 24 h rain total
        "end_date": day.isoformat(),
        "timezone": "auto",  # hourly times come back in local time
        "temperature_unit": "celsius",
        "wind_speed_unit": "kmh",
        "precipitation_unit": "mm",
    }
    base, source = (ARCHIVE_URL, "open-meteo-archive") if use_archive else (FORECAST_URL, "open-meteo-forecast")
    return f"{base}?{urllib.parse.urlencode(query, safe=',')}", source


def noon_observation(response, day, label=""):
    """Pick the FWI-style values for `day` out of an Open-Meteo hourly response.

    Hourly precipitation is the total for the preceding hour, so the 24 hours
    ending at noon are the hours labelled 13:00 the day before through 12:00.
    Returns None if the noon hour is not in the response.
    """
    hourly = response.get("hourly") or {}
    times = hourly.get("time") or []
    index = {t: i for i, t in enumerate(times)}
    noon = f"{day.isoformat()}T12:00"
    if noon not in index:
        warn(f"{label}no data for {noon} local time")
        return None

    def value(variable, i):
        series = hourly.get(variable) or []
        return series[i] if i < len(series) else None

    i = index[noon]
    window_start = datetime.fromisoformat(noon) - timedelta(hours=23)
    window = [index.get((window_start + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M")) for h in range(24)]
    rain = [value("precipitation", j) if j is not None else None for j in window]
    if any(r is None for r in rain):
        warn(f"{label}precipitation incomplete for the 24 h before {noon}; stored as NULL")
        precipitation = None
    else:
        precipitation = round(sum(rain), 2)

    offset = timedelta(seconds=response.get("utc_offset_seconds", 0))
    observed_at = (datetime.fromisoformat(noon) - offset).replace(tzinfo=timezone.utc)
    return {
        "observed_at": observed_at.isoformat(),
        "temperature_c": checked("temperature_c", value("temperature_2m", i), label),
        "relative_humidity_pct": checked("relative_humidity_pct", value("relative_humidity_2m", i), label),
        "wind_speed_kmh": checked("wind_speed_kmh", value("wind_speed_10m", i), label),
        "precipitation_mm": checked("precipitation_mm", precipitation, label),
        "vegetation_index": None,  # no NDVI source yet (#27): reported as missing, never invented
    }


def observation_row(area_id, observation, source):
    return (
        area_id, observation["observed_at"], observation["temperature_c"],
        observation["relative_humidity_pct"], observation["wind_speed_kmh"],
        observation["precipitation_mm"], observation["vegetation_index"], source,
    )


# ---------- network ----------

def fetch_json(url, timeout=30):
    request = urllib.request.Request(url, headers={"User-Agent": "EmberWatch-ECE444/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


# ---------- database ----------

def upsert_areas(conn, areas):
    """Insert or update the areas; returns {name: id}."""
    with conn.cursor() as cur:
        cur.executemany(UPSERT_AREA_SQL, [
            (a["name"], a["province"], a["latitude"], a["longitude"]) for a in areas
        ])
        cur.execute(AREA_IDS_SQL, ([a["name"] for a in areas],))
        ids = {name: area_id for area_id, name in cur.fetchall()}
    conn.commit()
    return ids


def update_terrain(conn, area_ids, rows):
    with conn.cursor() as cur:
        cur.executemany(UPDATE_TERRAIN_SQL, [
            (r["elevation_m"], r["slope_deg"], r["terrain_source"], r["terrain_retrieved_at"], area_ids[r["name"]])
            for r in rows
        ])
    conn.commit()


def insert_observations(conn, rows):
    """Returns the number of new rows (existing ones are skipped)."""
    inserted = 0
    with conn.cursor() as cur:
        for row in rows:
            cur.execute(INSERT_OBSERVATION_SQL, row)
            inserted += max(cur.rowcount, 0)
    conn.commit()
    return inserted


# ---------- main ----------

def collect(areas, days, today, fetch=fetch_json, skip_terrain=False):
    """Fetch everything first, so a network failure never leaves half-written data."""
    terrain = None
    if not skip_terrain:
        points = [p for a in areas for p in terrain_points(a["latitude"], a["longitude"])]
        elevations = fetch(elevation_url(points)).get("elevation") or []
        terrain = terrain_rows(areas, elevations, datetime.now(timezone.utc).isoformat())

    observations = []  # (area name, observation dict, source)
    for area in areas:
        for day in days:
            url, source = weather_request(area, day, today)
            observation = noon_observation(fetch(url), day, f"{area['name']} {day}: ")
            if observation is not None:
                observations.append((area["name"], observation, source))
    return terrain, observations


def parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--date", type=date.fromisoformat,
                        help="last day to load, YYYY-MM-DD (default: yesterday)")
    parser.add_argument("--days", type=int, default=1, help="number of days ending at --date (default 1)")
    parser.add_argument("--areas", default=AREAS_CSV, help="areas CSV (default data-processing/areas.csv)")
    parser.add_argument("--skip-terrain", action="store_true", help="don't fetch elevation/slope")
    parser.add_argument("--dry-run", action="store_true", help="print what would be stored; no database")
    args = parser.parse_args(argv)
    if args.days < 1:
        parser.error("--days must be at least 1")
    return args


def main(argv=None):
    args = parse_args(argv)
    today = date.today()
    last = args.date or today - timedelta(days=1)
    if last >= today:
        sys.exit("--date must be before today (noon values for today may not exist yet).")
    days = [last - timedelta(days=n) for n in range(args.days - 1, -1, -1)]
    areas = load_areas(args.areas)

    try:
        terrain, observations = collect(areas, days, today, skip_terrain=args.skip_terrain)
    except OSError as error:  # URLError, timeouts, HTTP errors
        sys.exit(f"Could not reach Open-Meteo ({error}). Nothing was written; check your internet and try again.")

    if args.dry_run:
        for row in terrain or []:
            print(f"TERRAIN {row['name']}: elevation={row['elevation_m']} m, slope={row['slope_deg']} deg")
        for name, obs, source in observations:
            print(f"WEATHER {name} {obs['observed_at']} [{source}]: T={obs['temperature_c']} C, "
                  f"RH={obs['relative_humidity_pct']} %, wind={obs['wind_speed_kmh']} km/h, "
                  f"rain24h={obs['precipitation_mm']} mm, NDVI=NULL")
        print(f"Dry run: {len(areas)} areas, {len(observations)} observations. Nothing written.")
        return

    import psycopg
    from dotenv import load_dotenv

    load_dotenv(os.path.join(HERE, "..", "backend", ".env"))
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set. Fill in backend/.env first (see backend/.env.example).")

    with psycopg.connect(url) as conn:
        area_ids = upsert_areas(conn, areas)
        if terrain:
            update_terrain(conn, area_ids, terrain)
        rows = [observation_row(area_ids[name], obs, source) for name, obs, source in observations]
        inserted = insert_observations(conn, rows)
    print(f"{len(areas)} areas saved"
          + ("" if terrain is None else ", terrain updated")
          + f". Inserted {inserted} new observations ({len(rows) - inserted} already in the database).")


if __name__ == "__main__":
    main()
