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

The approach is inspired by fire-danger indices such as Canada's Fire Weather Index: hot, dry, windy weather after little rain raises danger. It adds nearby satellite detection history as a separate contextual factor.

**Fire history** is the number of rows in the Supabase `public.detections` table that meet both conditions:
- Detection confidence is at least the configured `MIN_DETECTION_CONFIDENCE` threshold (default: 20; see `backend/config.py`).
- The detection is within **50 km** of the area centre.

The scoring query has no date restriction or fire-type filter. It counts qualifying records currently stored in the database; **2023–2025 describes the documented dataset currently loaded, not a hard-coded query date range**. The count is a historical activity proxy, not a measure of current fire danger or confirmation of active fires.

The history sub-score uses a logarithmic scale: 1 detection ≈ 10, 10 ≈ 35, 100 ≈ 67, and 1,000 or more = 100.

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

These are illustrative assessment results from a database snapshot, not fixed expected values or current live readings. Counts and scores can change as stored observations and environmental inputs change.

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

These measures describe different things and must not be interpreted interchangeably.

- **Detection confidence** (`/api/detections`, field `confidence`, 0–100) describes the confidence associated with an individual NASA FIRMS satellite observation. It is not a probability that a wildfire exists, a guarantee that the observation is a fire, or a measure of environmental risk.
- **Environmental risk** (`/api/risk-areas`, `/api/risk-score`, fields `risk_score` and `risk_level`) is a weighted estimate of how fire-prone a monitored area may be, based on available environmental factors and nearby detection history.

### How the detection threshold is used

`MIN_DETECTION_CONFIDENCE` defaults to 20 and can be overridden through the environment. In the detection pipeline, it is a **classification threshold**:

- Valid detections meeting the threshold are classified as `potential_wildfire`.
- Valid detections below the threshold are retained and classified as `low_confidence`.
- Invalid or unavailable observations are handled separately rather than being assigned fabricated confidence values.

The threshold also affects the risk model's `nearby_detections` factor: only stored detections meeting the configured threshold contribute to that count.

The risk model does not use an individual detection's confidence as a scoring factor. Passing a `confidence` field to `score_area()` does not change its result. These distinctions are covered by `backend/tests/test_risk_validation_57.py`.

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

#### Results (run on 2026-11-11, `weighted-index-v1`)

| Town | Fire day | Score (level) | Same day, year before | 15 January |
|---|---|---|---|---|
| Slave Lake | 2011-05-15 | 58.5 (MODERATE) | 51.8 (MODERATE) | 19.2 (LOW) |
| Fort McMurray | 2016-05-03 | 57.3 (MODERATE) | 28.6 (LOW) | 23.4 (LOW) |
| Lytton | 2021-06-30 | 68.2 (MODERATE) | 14.4 (LOW) | 18.2 (LOW) |
| Hay River | 2023-05-14 | 65.3 (MODERATE) | 33.3 (LOW) | 17.2 (LOW) |
| Yellowknife | 2023-08-16 | 44.6 (MODERATE) | 41.1 (MODERATE) | 16.2 (LOW) |
| Kelowna | 2023-08-17 | 72.5 (HIGH) | 65.2 (MODERATE) | 14.9 (LOW) |
| Jasper | 2024-07-24 | 57.8 (MODERATE) | 45.0 (MODERATE) | 32.9 (LOW) |
| **Mean** | | **60.6** | **39.9** | **20.3** |

Full inputs per day: [ml/results/risk_validation.csv](../ml/results/risk_validation.csv).

**What this shows**

- **The selected fire days scored higher than their selected controls.** All seven fire-day scores exceeded the same-calendar-day score from the previous year (7/7) and the 15 January comparison (7/7). This is an encouraging sanity check, not evidence of general predictive performance.
- **Most selected fire days were not rated HIGH.** Only 1 of 7 received a HIGH rating; the other six were MODERATE. Lytton scored 68.2 on the day it burned, just below the HIGH boundary of 70. This illustrates how the current thresholds behave on these examples, but does not establish that the boundary should be changed.
- **Some differences were small.** Yellowknife scored only 3.5 points above its previous-year comparison, and Slave Lake scored 6.7 points above its comparison. A single day's weather cannot represent the full conditions contributing to a wildfire.
- **The inputs have important temporal and spatial limits.** Noon weather and a roughly 9–25 km grid cell do not capture afternoon peaks, local gusts, overnight conditions, or multi-day drought.

These results do not justify changing the weights or HIGH boundary on their own. Any adjustment should be evaluated against a substantially larger and representative set of fire and non-fire observations, with appropriate held-out testing.

## Limitations and next steps

- Weights and ranges are expert-set, not learned. Mild conditions can still reach MODERATE (for example, the Toronto illustration above), so the level boundaries and weights require further evaluation.
- **The historical check is a small sanity check, not evidence of calibrated risk levels.** Only 1 of 7 selected fire days scored HIGH. This is insufficient evidence to establish an appropriate HIGH boundary or to recommend a specific adjustment.
- **Validation is a small sanity check, not an evaluation.** Seven hand-picked famous fires with one control day each cannot measure accuracy, false-alarm rate or calibration. A real evaluation needs many fire and non-fire days (for example, every FIRMS fire start vs. random days and places) and ideally burned-area maps.
- **Selection bias:** the events are fires big enough to make the news, which usually happened in extreme weather, so they are the easiest cases for the model.
- Weights should be fitted to data (for example, logistic regression on past weather vs. where FIRMS fires started) once there is enough labelled data.
- NDVI is not connected yet, so live scores are always incomplete.
