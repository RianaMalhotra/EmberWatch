"""Reproduce the tiny exploratory weather classifier; Python stdlib only.

WARNING: seven selected fires and their two comparison dates per fire are NOT
representative negative wildfire samples. Outputs are NOT fire probabilities.
"""
import csv
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FEATURES = ("temperature_c", "relative_humidity_pct", "wind_speed_kmh", "precipitation_mm")


def load_rows(path):
    with path.open(newline="", encoding="utf-8") as file:
        return [
            {"group": row["event"], "y": int(row["case"] == "fire_day"),
             "x": [float(row[key]) for key in FEATURES]}
            for row in csv.DictReader(file)
        ]


def fit(rows):
    means = [sum(row["x"][i] for row in rows) / len(rows) for i in range(4)]
    scales = [
        math.sqrt(sum((row["x"][i] - means[i]) ** 2 for row in rows) / len(rows)) or 1
        for i in range(4)
    ]
    weights = [0.0] * 5
    for _ in range(2500):
        gradient = [0.0] * 5
        for row in rows:
            x = [1.0] + [(v - means[i]) / scales[i] for i, v in enumerate(row["x"])]
            z = sum(w * v for w, v in zip(weights, x))
            probability = 1 / (1 + math.exp(-max(-30, min(30, z))))
            for i in range(5):
                gradient[i] += (probability - row["y"]) * x[i]
        for i in range(5):
            weights[i] -= 0.09 * (gradient[i] / len(rows) + (0.12 * weights[i] if i else 0))
    return {"means": means, "scales": scales, "weights": weights}


def predict(model, row):
    z = model["weights"][0] + sum(
        model["weights"][i + 1] * (value - model["means"][i]) / model["scales"][i]
        for i, value in enumerate(row["x"])
    )
    return 1 / (1 + math.exp(-max(-30, min(30, z))))


def train(rows):
    groups = sorted({row["group"] for row in rows})
    wins = 0
    for group in groups:
        model = fit([row for row in rows if row["group"] != group])
        test = [row for row in rows if row["group"] == group]
        fire = next(row for row in test if row["y"] == 1)
        controls = [row for row in test if row["y"] == 0]
        wins += predict(model, fire) > max(predict(model, row) for row in controls)
    return {
        "model_version": "historical-weather-logreg-v1",
        "kind": "regularized logistic regression",
        "features": list(FEATURES),
        **fit(rows),
        "training_examples": len(rows),
        "positive_examples": sum(row["y"] for row in rows),
        "independent_events": len(groups),
        "group_holdout_fire_above_both_controls": wins,
        "group_holdout_events": len(groups),
        "warning": "Selected fire-day versus historical-control classification, not a calibrated wildfire probability or validated operational forecast.",
    }


if __name__ == "__main__":
    rows = load_rows(ROOT / "ml/results/risk_validation.csv")
    output = ROOT / "frontend/src/data/weatherClassifier.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(train(rows), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output}")
