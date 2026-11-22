"""Backtest the detection confidence threshold on historical FIRMS data (#19).

The question: which minimum confidence keeps the most real wildfire
detections while filtering out the most false ones?

Answer key ("ground truth")
---------------------------
FIRMS does not say which detections were real fires, so we need a proxy.

* ``persistence`` (default): a detection counts as a real fire if another
  detection appears within ``radius_km`` (2 km) between 1 and
  ``window_hours`` (72 h) later. Real fires usually keep burning and get
  detected again on later satellite passes; one-off false hotspots don't.
  Detections in the last ``window_hours`` of the data are left out, because
  there is no "later" data to confirm them.
* ``type``: uses the FIRMS archive ``type`` column (0 = presumed vegetation
  fire). For Canada this is ~99.9% type 0, so it can't separate good and
  bad thresholds; it is kept only for comparison.

Choosing the threshold
----------------------
Most detections are real fires, so F1 and precision always look best at
threshold 0. Instead the recommendation maximises **Youden's J**
(true-positive rate minus false-positive rate), which is not fooled by
class imbalance, among thresholds that still catch at least ``min_recall``
(90%) of real fires: for early detection, missing a fire is worse than a
false alarm. F1, precision and recall are still reported.

Usage (from the repository root):

    python data-processing/firms_cleaning.py fire_archive.csv cleaned.csv
    python ml/backtest_threshold.py cleaned.csv backtest_results.csv
    python ml/backtest_threshold.py cleaned.csv results.csv --label type
"""

import argparse
import csv
import math
from bisect import bisect_left, bisect_right
from collections import defaultdict
from datetime import datetime

WILDFIRE_TYPE = "0"
DEFAULT_THRESHOLDS = list(range(0, 101, 5))
KM_PER_DEG_LAT = 110.57
EARTH_RADIUS_KM = 6371.0


# ---------------------------------------------------------------------------
# Labelling
# ---------------------------------------------------------------------------

def load_labelled(rows):
    """Label rows using the FIRMS ``type`` column.

    Returns (list of (confidence, is_wildfire), number of unlabelled rows).
    """
    labelled, unlabelled = [], 0
    for row in rows:
        fire_type = (row.get("type") or "").strip()
        confidence = (row.get("confidence") or "").strip()
        if fire_type == "" or confidence == "":
            unlabelled += 1
            continue
        try:
            score = float(confidence)
        except ValueError:
            unlabelled += 1
            continue
        labelled.append((score, fire_type == WILDFIRE_TYPE))
    return labelled, unlabelled


def _parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def _distance_km(lat1, lon1, lat2, lon2):
    """Great-circle distance (haversine)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def label_by_persistence(rows, radius_km=2.0, window_hours=72.0, min_gap_hours=1.0):
    """Label each detection by whether the fire was detected again later.

    A detection is a real fire if another detection lies within
    ``radius_km`` and between ``min_gap_hours`` and ``window_hours`` later.
    The minimum gap skips neighbouring pixels from the same satellite pass.

    Returns (list of (confidence, is_fire), number of rows left out).
    """
    points = []
    skipped = 0
    for row in rows:
        try:
            points.append((
                float(row["latitude"]),
                float(row["longitude"]),
                _parse_time(row["timestamp"]),
                float(row["confidence"]),
            ))
        except (KeyError, TypeError, ValueError, AttributeError):
            skipped += 1

    if not points:
        return [], skipped

    min_gap = min_gap_hours * 3600
    window = window_hours * 3600
    last_time = max(p[2] for p in points)

    # Spatial grid with cells of radius_km, so neighbours are in the 3x3 block.
    def cell(lat, lon):
        x = lon * KM_PER_DEG_LAT * math.cos(math.radians(lat))
        y = lat * KM_PER_DEG_LAT
        return int(math.floor(x / radius_km)), int(math.floor(y / radius_km))

    grid = defaultdict(list)
    for lat, lon, t, _ in points:
        grid[cell(lat, lon)].append((t, lat, lon))
    times = {}
    for key, items in grid.items():
        items.sort()
        times[key] = [item[0] for item in items]

    labelled = []
    for lat, lon, t, confidence in points:
        if t + window > last_time:
            skipped += 1  # can't be confirmed: no data after it
            continue
        cx, cy = cell(lat, lon)
        confirmed = False
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                key = (cx + dx, cy + dy)
                if key not in grid:
                    continue
                cell_times = times[key]
                lo = bisect_left(cell_times, t + min_gap)
                hi = bisect_right(cell_times, t + window)
                for _, other_lat, other_lon in grid[key][lo:hi]:
                    if _distance_km(lat, lon, other_lat, other_lon) <= radius_km:
                        confirmed = True
                        break
                if confirmed:
                    break
            if confirmed:
                break
        labelled.append((confidence, confirmed))
    return labelled, skipped


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def metrics_from_counts(threshold, tp, fp, fn, tn):
    """Metrics from confusion-matrix counts (a detection is "kept" if its
    confidence is at or above the threshold; kept means predicted real)."""
    total = tp + fp + fn + tn
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    false_positive_rate = fp / (fp + tn) if fp + tn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    kept_share = (tp + fp) / total if total else 0.0
    return {
        "threshold": threshold,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "false_positive_rate": round(false_positive_rate, 4),
        "youden_j": round(recall - false_positive_rate, 4),
        "f1": round(f1, 4),
        "kept_share": round(kept_share, 4),
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "true_negatives": tn,
    }


def score_threshold(labelled, threshold):
    """Metrics when keeping detections with confidence >= threshold."""
    tp = fp = fn = tn = 0
    for confidence, is_fire in labelled:
        kept = confidence >= threshold
        if kept and is_fire:
            tp += 1
        elif kept:
            fp += 1
        elif is_fire:
            fn += 1
        else:
            tn += 1
    return metrics_from_counts(threshold, tp, fp, fn, tn)


def choose_threshold(results, min_recall=0.9):
    """The recommended row from per-threshold results.

    Only thresholds with recall >= min_recall are considered (if none
    qualify, all are). The best Youden's J wins; ties go to the higher
    threshold (fewer false alarms).
    """
    candidates = [r for r in results if r["recall"] >= min_recall] or results
    return max(candidates, key=lambda r: (r["youden_j"], r["threshold"]))


def run_backtest(labelled, thresholds=None, min_recall=0.9):
    """Score every threshold and recommend the one with the best Youden's J.

    Only thresholds with recall >= min_recall are considered (if none
    qualify, all are). Ties go to the higher threshold (fewer false alarms).
    """
    if not labelled:
        raise ValueError("No labelled rows to score.")
    if all(is_fire for _, is_fire in labelled) or not any(is_fire for _, is_fire in labelled):
        raise ValueError("All rows have the same label, so thresholds can't be compared.")
    results = [score_threshold(labelled, t) for t in (thresholds or DEFAULT_THRESHOLDS)]
    return results, choose_threshold(results, min_recall)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("cleaned_csv")
    parser.add_argument("results_csv")
    parser.add_argument("--label", choices=["persistence", "type"], default="persistence")
    parser.add_argument("--radius-km", type=float, default=2.0)
    parser.add_argument("--window-hours", type=float, default=72.0)
    parser.add_argument("--min-recall", type=float, default=0.9,
                        help="only recommend thresholds that keep at least this share of real fires")
    args = parser.parse_args(argv)

    with open(args.cleaned_csv, newline="", encoding="utf-8") as source:
        rows = list(csv.DictReader(source))

    if args.label == "type":
        labelled, skipped = load_labelled(rows)
    else:
        labelled, skipped = label_by_persistence(rows, args.radius_km, args.window_hours)

    results, best = run_backtest(labelled, min_recall=args.min_recall)

    with open(args.results_csv, "w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=list(results[0].keys()))
        writer.writeheader()
        writer.writerows(results)

    fires = sum(1 for _, is_fire in labelled if is_fire)
    print(f"Label: {args.label}. Scored {len(labelled)} detections "
          f"({fires} real fires, {len(labelled) - fires} not confirmed); left out {skipped}.")
    print(f"Recommended threshold (recall >= {args.min_recall:.0%}): {best['threshold']} "
          f"(recall {best['recall']}, false-positive rate {best['false_positive_rate']}, "
          f"precision {best['precision']}, Youden J {best['youden_j']}, "
          f"keeps {best['kept_share']:.0%} of detections).")
    print(f"Full results written to {args.results_csv}.")


if __name__ == "__main__":
    main()
