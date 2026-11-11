# Wildfire risk-scoring model (#21)

Code: `backend/services/risk_scoring.py` · API: `POST /api/risk-score` · Version: `weighted-index-v1`

## What it does

Combines environmental factors into one **0–100 risk score** per area, then maps it to the levels the map uses:

| Score | Level |
|---|---|
| 0 – 39.9 | LOW |
| 40 – 69.9 | MODERATE |
| 70 – 100 | HIGH |

## Factors and weights

Each input becomes a 0–100 "danger" sub-score (higher = more fire-prone). Sub-scores are combined with these weights:

| Factor | Input | 0 at… | 100 at… | Weight |
|---|---|---|---|---|
| Temperature | `temperature_c` | ≤ 5 °C | ≥ 35 °C | 0.15 |
| Humidity | `relative_humidity_pct` | ≥ 80 % | ≤ 15 % | 0.20 |
| Wind | `wind_speed_kmh` | 0 km/h | ≥ 50 km/h | 0.15 |
| Recent rain | `precipitation_mm` | ≥ 10 mm | 0 mm | 0.10 |
| Vegetation (fuel) | `vegetation_index` (NDVI) | ≤ 0.1 | ≥ 0.7 | 0.10 |
| Terrain | `slope_deg` | 0° | ≥ 30° | 0.05 |
| Fire history | `nearby_detections` | 0 | ≥ 1000 (log scale) | 0.25 |

The approach follows fire-danger indices such as Canada's Fire Weather Index (hot, dry, windy weather after little rain raises danger) and adds local fire history. **Fire history** is the number of NASA FIRMS detections (confidence ≥ the #19 threshold of 20) within **50 km**, counted from the Supabase `detections` table (2023–2025). On a log scale, 1 detection ≈ 10, 10 ≈ 35, 100 ≈ 67, 1000+ = 100.

## Missing inputs (#24, #28)

- Missing, `null` or out-of-range inputs are **never filled with made-up values**.
- The score uses the available factors, re-weighted to add up to 1, and the result has `is_complete: false` plus a `missing_inputs` list.
- If the available factors carry **less than 50 %** of the total weight, `risk_score` and `risk_level` are `null` (not enough information).
- If the database can't be reached, fire history is treated as a missing input; the API still answers.

## API

`POST /api/risk-score` with any of the inputs above. Give `latitude` and `longitude` instead of `nearby_detections` to have fire history looked up automatically.

```json
{ "temperature_c": 33, "relative_humidity_pct": 18, "wind_speed_kmh": 30,
  "precipitation_mm": 0, "vegetation_index": 0.45, "slope_deg": 12,
  "latitude": 49.888, "longitude": -119.496 }
```

Response (`data`): `risk_score`, `risk_level`, `is_complete`, `missing_inputs`, `coverage` (share of weight available), `factor_scores` (each factor's 0–100 sub-score), `model_version`.

Results can be stored with `save_assessment()` in the `risk_assessments` table.

## Examples (real fire-history counts from the database)

| Area and conditions | Nearby detections (50 km) | Score | Level |
|---|---|---|---|
| Kelowna, hot dry windy August day | 673 | 83.5 | HIGH |
| Toronto, mild June day | 21 | 44.3 | MODERATE |
| Ottawa, warm day, wind sensor missing | 22 | 59.1 | MODERATE (incomplete: `wind_speed_kmh`) |

## Model version

`model_version` is returned with every result and stored in `risk_assessments`, so a score can always be traced to the rules that produced it. The current version is **`weighted-index-v1`**: fixed, expert-set weights and ranges (above), not learned from data. Change the version string whenever a weight, range, level boundary or the history radius changes. (#57 only tightened input checking, so the version did not change.)

## Assumptions

- **Higher is more fire-prone for every factor**, using fixed linear ranges (log scale for fire history). The ranges are plausible fire-weather values for Canada, not calibrated thresholds.
- **Noon weather and 24 h rain describe the day**, following the Fire Weather Index convention. Afternoon peaks, overnight conditions and multi-day drought are not captured.
- **The town centre stands for the whole area.** Each area is one point, and its weather is one Open-Meteo grid cell (about 9–25 km).
- **Past detections within 50 km mean the landscape burns**, so fire history is a proxy for fuel and ignition likelihood, not for today's danger.
- **Factors are independent and add up.** Interactions (for example, wind only matters when fuel is dry) are not modelled.

## Coverage and missing inputs

`coverage` is the share of the total weight whose inputs were available (0–1). Missing, `null`, out-of-range, NaN, infinite, boolean or text inputs are all treated as missing. The score is re-weighted over the available factors, `is_complete` is `false` and `missing_inputs` lists what was left out. Every factor is either in `factor_scores` or in `missing_inputs`, never both.

| Coverage | Result |
|---|---|
| 1.0 | Complete score |
| 0.5 – 0.99 | Score and level shown, marked incomplete |
| below 0.5 | `risk_score` and `risk_level` are `null`; the available `factor_scores` are still returned |

In the deployed app today **NDVI is always missing** (there is no vegetation source yet), so live scores have coverage 0.90 at best.

## Where each input comes from (provenance)

| Input | Source | Details |
|---|---|---|
| `temperature_c`, `relative_humidity_pct`, `wind_speed_kmh` | Open-Meteo (`temperature_2m`, `relative_humidity_2m`, `wind_speed_10m`) | Value at 12:00 local time. ERA5 archive for days 6+ days old (`source = open-meteo-archive`), forecast API's recent past otherwise (`open-meteo-forecast`) |
| `precipitation_mm` | Open-Meteo `precipitation` | Sum of the 24 h ending at noon; `null` if any hour is missing |
| `slope_deg` | Open-Meteo Elevation API (Copernicus DEM GLO-90) | From elevations 250 m N/S/E/W of the area centre; stored once per area with `terrain_source` |
| `vegetation_index` | none yet | Always `null`, reported as missing (#27) |
| `nearby_detections` | NASA FIRMS, `detections` table | Count with confidence ≥ the #19 threshold (20) within 50 km. See [detection-data-provenance.md](detection-data-provenance.md) |

Full loader details are in [environmental-data.md](environmental-data.md). Every stored observation keeps its `source` and `observed_at`, and every risk area in the API returns its `environmental_factors` and `observed_at`, so a score can be traced back to the exact inputs.

## Risk is not detection confidence

These are two different things and are kept separate everywhere:

- **Detection confidence** (`/api/detections`, field `confidence` 0–100) is how sure the satellite algorithm is that one hotspot is a fire *right now*.
- **Risk** (`/api/risk-areas`, `/api/risk-score`, fields `risk_score` and `risk_level`) is how fire-prone an *area* is given weather, terrain and history.

Confidence only enters the risk model through the threshold that decides which past detections are counted in `nearby_detections`. The model ignores any `confidence` field it is given, and the two APIs never share these fields (tested in `backend/tests/test_risk_validation_57.py`).

## Validation (#57)

### Automated tests

`backend/tests/test_risk_validation_57.py` checks:

- **Deterministic output:** the same inputs give an identical result 200 times in a row, whatever the key order. The API and a direct model call agree, and the input is not modified.
- **Explainability:** the score can be rebuilt from the returned `factor_scores` and the documented weights (within rounding). The level always matches the score, and the weights match this document.
- **Missing data:** each factor missing on its own is reported with the right coverage. Coverage of exactly 0.5 still scores, and below 0.5 gives no score. NaN, ±infinity, booleans and text all count as missing.
- **Risk vs confidence:** confidence fields do not change risk, and the risk and detection APIs use separate fields.

Found and fixed during validation: an **infinite `nearby_detections`** passed the open-ended range check and scored the maximum 100. Non-finite values are now treated as missing.

### Comparison with historical fires

`ml/validate_risk_model.py` scores the weather at seven towns on the day a major wildfire hit them ([ml/data/historical_fire_events.csv](../ml/data/historical_fire_events.csv)), and compares it with the same calendar day one year earlier and with 15 January:

```
python ml/validate_risk_model.py
```

It uses the same Open-Meteo and elevation code as the app (`data-processing/load_environment_to_db.py`). **Fire history is deliberately left out.** The detections table covers 2023–2025, so for 2023–2024 events it would already contain the fire being tested (data leakage), and for 2011–2021 events it would be empty. Scores are therefore weather and terrain only (coverage 0.65, marked incomplete). Per-day results go to `ml/results/risk_validation.csv`.

## Limitations and next steps

- Weights and ranges are expert-set, not learned. Mild conditions can still reach MODERATE (e.g. Toronto above), so the level boundaries and weights should be tuned.
- **Validation is a small sanity check, not an evaluation.** Seven hand-picked famous fires with one control day each cannot measure accuracy, false-alarm rate or calibration. A real evaluation needs many fire and non-fire days (for example, every FIRMS fire start vs. random days and places) and ideally burned-area maps.
- **Selection bias:** the events are fires big enough to make the news, which usually happened in extreme weather, so they are the easiest cases for the model.
- Weights should be fitted to data (for example, logistic regression on past weather vs. where FIRMS fires started) once there is enough labelled data.
- NDVI is not connected yet, so live scores are always incomplete.
