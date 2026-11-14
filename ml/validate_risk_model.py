"""Compare the risk model with real historical wildfires (#57).

Question: on the day a major wildfire hit a town, does the model rate the
weather there as more dangerous than on ordinary days at the same place?

For every event in ml/data/historical_fire_events.csv the script scores three
days at the town, using the same inputs and sources the app uses
(Open-Meteo noon weather + 24 h rain, Copernicus DEM slope):

* ``fire_day``         the day of the fire (event_date)
* ``prev_year``        the same calendar day one year earlier (no major fire there)
* ``off_season``       15 January of the event year (snow season)

Fire history is left out on purpose: the detections table covers 2023-2025,
so for 2023-2024 events it would already contain the fire being tested
(data leakage), and for older events it would be empty. The score is
therefore weather + terrain only and is marked incomplete; NDVI is also
missing because there is no vegetation source yet (#27). Coverage is 0.65,
above the 0.5 minimum, so every day still gets a score.

Usage (from the repository root, needs internet, no database or API key):

    python ml/validate_risk_model.py
    python ml/validate_risk_model.py --output ml/results/risk_validation.csv

This is a small sanity check (7 events), not a statistical evaluation.
"""

import argparse
import csv
import os
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "data-processing"))
sys.path.insert(0, os.path.join(ROOT, "backend"))

import load_environment_to_db as env  # noqa: E402  (same fetch/parse code as the app)
from services.risk_scoring import MODEL_VERSION, score_area  # noqa: E402

EVENTS_CSV = os.path.join(HERE, "data", "historical_fire_events.csv")
DEFAULT_OUTPUT = os.path.join(HERE, "results", "risk_validation.csv")

CASES = ("fire_day", "prev_year", "off_season")
WEATHER_FIELDS = ("temperature_c", "relative_humidity_pct", "wind_speed_kmh", "precipitation_mm")


def load_events(path=EVENTS_CSV):
    with open(path, newline="", encoding="utf-8") as f:
        events = []
        for row in csv.DictReader(f):
            row["latitude"] = float(row["latitude"])
            row["longitude"] = float(row["longitude"])
            row["event_date"] = date.fromisoformat(row["event_date"])
            events.append(row)
    return events


def case_dates(event_date):
    """The three days scored for one event, in CASES order."""
    try:
        prev_year = event_date.replace(year=event_date.year - 1)
    except ValueError:  # 29 February
        prev_year = event_date.replace(year=event_date.year - 1, day=28)
    return {
        "fire_day": event_date,
        "prev_year": prev_year,
        "off_season": date(event_date.year, 1, 15),
    }


def event_slope(event, fetch):
    """Slope at the town centre, computed exactly like areas.slope_deg."""
    points = env.terrain_points(event["latitude"], event["longitude"])
    response = fetch(env.elevation_url(points))
    elevations = response.get("elevation") or []
    if len(elevations) != 5 or any(e is None for e in elevations):
        return None
    return env.checked("slope_deg", env.slope_from_elevations(*elevations), f"{event['name']}: ")


def score_day(event, day, slope, fetch, today):
    """Fetch noon weather for one day and score it without fire history."""
    url, source = env.weather_request(event, day, today)
    observation = env.noon_observation(fetch(url), day, f"{event['name']} {day}: ")
    inputs = {field: (observation or {}).get(field) for field in WEATHER_FIELDS}
    inputs["vegetation_index"] = None
    inputs["slope_deg"] = slope
    inputs["nearby_detections"] = None  # left out on purpose, see module docstring
    result = score_area(inputs)
    return inputs, result, source


def run(events, fetch=env.fetch_json, today=None):
    today = today or date.today()
    rows = []
    for event in events:
        slope = event_slope(event, fetch)
        for case, day in case_dates(event["event_date"]).items():
            inputs, result, source = score_day(event, day, slope, fetch, today)
            rows.append({
                "event": event["name"],
                "case": case,
                "date": day.isoformat(),
                **inputs,
                "risk_score": result["risk_score"],
                "risk_level": result["risk_level"],
                "coverage": result["coverage"],
                "missing_inputs": ";".join(result["missing_inputs"]),
                "model_version": result["model_version"],
                "weather_source": source,
            })
    return rows


def summarize(rows):
    """Headline numbers: how often the fire day looks worse than the controls."""
    by_event = {}
    for row in rows:
        by_event.setdefault(row["event"], {})[row["case"]] = row["risk_score"]

    compared = {"prev_year": [0, 0], "off_season": [0, 0]}  # [fire day higher, comparable pairs]
    for scores in by_event.values():
        fire = scores.get("fire_day")
        for control in compared:
            other = scores.get(control)
            if fire is None or other is None:
                continue
            compared[control][1] += 1
            if fire > other:
                compared[control][0] += 1

    fire_rows = [r for r in rows if r["case"] == "fire_day"]
    levels = {level: sum(1 for r in fire_rows if r["risk_level"] == level)
              for level in ("HIGH", "MODERATE", "LOW", None)}

    def mean(case):
        values = [r["risk_score"] for r in rows if r["case"] == case and r["risk_score"] is not None]
        return round(sum(values) / len(values), 1) if values else None

    return {
        "events": len(by_event),
        "fire_day_levels": levels,
        "fire_day_above_prev_year": tuple(compared["prev_year"]),
        "fire_day_above_off_season": tuple(compared["off_season"]),
        "mean_score": {case: mean(case) for case in CASES},
    }


def write_csv(rows, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def print_report(rows, summary):
    print(f"Risk model {MODEL_VERSION}: weather + terrain only (no fire history, no NDVI)\n")
    print(f"{'event':<14} {'case':<11} {'date':<11} {'temp':>5} {'RH':>4} {'wind':>5} {'rain':>5}  {'score':>5}  level")
    for r in rows:
        def fmt(value, width):
            return f"{value:>{width}}" if value is not None else f"{'-':>{width}}"
        print(f"{r['event']:<14} {r['case']:<11} {r['date']:<11} {fmt(r['temperature_c'], 5)} "
              f"{fmt(r['relative_humidity_pct'], 4)} {fmt(r['wind_speed_kmh'], 5)} "
              f"{fmt(r['precipitation_mm'], 5)}  {fmt(r['risk_score'], 5)}  {r['risk_level'] or '-'}")
    levels = summary["fire_day_levels"]
    above_prev, n_prev = summary["fire_day_above_prev_year"]
    above_off, n_off = summary["fire_day_above_off_season"]
    print()
    print(f"Fire days rated HIGH: {levels['HIGH']}/{summary['events']}, "
          f"MODERATE: {levels['MODERATE']}, LOW: {levels['LOW']}, no score: {levels[None]}")
    print(f"Fire day scored higher than the same day a year earlier: {above_prev}/{n_prev}")
    print(f"Fire day scored higher than 15 January: {above_off}/{n_off}")
    print("Mean score: " + ", ".join(f"{case} {value}" for case, value in summary["mean_score"].items()))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--events", default=EVENTS_CSV)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)

    rows = run(load_events(args.events))
    write_csv(rows, args.output)
    print_report(rows, summarize(rows))
    print(f"\nPer-day results written to {os.path.relpath(args.output, ROOT)}")


if __name__ == "__main__":
    main()
