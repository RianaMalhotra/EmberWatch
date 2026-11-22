# Detection confidence threshold: backtest results (#19) and held-out evaluation (#56)

**Chosen value:** `DEFAULT_MIN_DETECTION_CONFIDENCE = 20` in `backend/config.py` (provisional).
It can be overridden with the `MIN_DETECTION_CONFIDENCE` environment variable.

## Data

NASA FIRMS **MODIS Collection 6.1**, standard-processing country yearly summaries for **Canada**. Raw files are not committed; see `data-processing/README.md` to download them.

| Year | Detections (all kept after cleaning) |
|---|---|
| 2023 | 324,003 |
| 2024 | 147,547 |
| 2025 | 156,313 |

## Method

1. Clean each file with `data-processing/firms_cleaning.py`.
2. **Answer key (persistence):** a detection counts as a real fire if another detection is within **2 km**, **1–72 hours later**. Real fires keep burning and are detected again; one-off false hotspots are not. Detections in the last 72 hours of the data are left out because they can't be confirmed.
3. Score thresholds 0–100 (step 5) and recommend the one with the best **Youden's J** (recall minus false-positive rate) among thresholds that keep **at least 90% of real fires**. For early detection, missing a fire is worse than a false alarm.

The FIRMS `type` column was tried first, but ~99.9% of Canadian detections are type 0 ("presumed vegetation fire"), so it could not separate thresholds.

## Results

| Year | Real fires / one-offs | Recommended | Recall | One-offs still kept | Youden's J |
|---|---|---|---|---|---|
| 2023 | 263,563 / 60,406 | **20** | 0.911 | 0.873 | 0.038 |
| 2024 | 119,773 / 27,699 | **20** | 0.908 | 0.890 | 0.018 |
| 2025 | 123,353 / 32,946 | **15** | 0.900 | 0.887 | 0.013 |

The recommendation is stable across three seasons (15–20), so **20** was chosen.

## Held-out evaluation (#56)

The backtest above picks a threshold and scores it on the same year, so it can look better than it will in use. `ml/evaluate_threshold_split.py` adds a train/evaluation split: the threshold is chosen on **training years only** (same rule: best Youden's J among thresholds that keep at least 90% of real fires), then scored on years it never saw. It works from the per-threshold counts in `ml/results/backtest_<year>.csv`, which add up across years. Output: `ml/results/threshold_split_evaluation.csv`.

**Main split (time-ordered: learn from the past, apply to the future).** Chosen on 2023+2024 (**threshold 20**), scored on **2025**:

| 2025 held-out, threshold 20 | Predicted real (kept) | Predicted one-off (dropped) |
|---|---|---|
| **Actually real** | 109,640 | 13,713 |
| **Actually one-off** | 28,786 | 4,160 |

Precision **0.792**, recall **0.889**, false-positive rate **0.874**, Youden's J 0.015. The filter drops 11.1% of real fires and only 12.6% of one-off hotspots. With no filter (threshold 0), 2025 precision would be 0.789, so threshold 20 improves precision by about 0.3 percentage points.

**Leave-one-year-out** (each year held out in turn, threshold chosen on the other two):

| Held-out year | Chosen on | Threshold | Precision | Recall | False-positive rate |
|---|---|---|---|---|---|
| 2023 | 2024+2025 | 15 | 0.819 | 0.923 | 0.888 |
| 2024 | 2023+2025 | 20 | 0.815 | 0.908 | 0.890 |
| 2025 | 2023+2024 | 20 | 0.792 | 0.889 | 0.874 |

What this shows:

- **The choice is stable.** Every fold picks 15 or 20.
- **The 90% recall target does not reliably hold out of sample.** It held in two of the three held-out years; in 2025 recall fell to 88.9%.
- **The filter has little effect.** In the held-out years it drops only slightly more of the one-off hotspots (11-13%) than of the real fires (8-11%), so precision barely moves. Threshold 20 is a provisional, low-impact setting.

These are **proxy-based estimates, not validated accuracy** (see Limitations).

2023 trade-off across thresholds (share kept):

| Threshold | 0 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Real fires | 1.00 | 0.93 | 0.91 | 0.88 | 0.82 | 0.76 | 0.69 | 0.60 | 0.49 | 0.37 | 0.24 |
| One-off hotspots | 1.00 | 0.90 | 0.87 | 0.83 | 0.76 | 0.68 | 0.58 | 0.48 | 0.36 | 0.24 | 0.14 |

## Limitations

- **Confidence alone is a weak filter.** Real fires and one-off hotspots are dropped at nearly the same rate as the threshold rises. The best separation (J = 0.13 at 80) would discard half of all real fires. Precision only rises from 0.81 to 0.88 across the full range.
- **Persistence is a proxy, not field-verified truth.** Short-lived real fires count as "one-offs", and a false hotspot next to a real fire can be counted as real.
- **No validated accuracy is claimed.** Without field-verified ground truth, every precision, recall and false-positive figure here, including the held-out ones, is measured against the persistence proxy. Treat them as estimates of how the filter behaves, not as the real-world accuracy of wildfire detection.
- **The split is small.** There are three seasons, so the main split has a single test season (2025) and the leave-one-year-out check has only three folds. Thresholds are scored in steps of 5. The held-out figures give a rough idea of stability, not a tight confidence interval.
- **Next step:** combine confidence with other signals (repeat detection, FRP, land cover), or validate against official burned-area perimeters (e.g. NBAC).

## Reproduce

```bash
# 1. Per year (needs the downloaded FIRMS file; repeat for 2024 and 2025)
python data-processing/firms_cleaning.py data-processing/data/modis_2023_Canada.csv data-processing/data/cleaned_2023.csv
python ml/backtest_threshold.py data-processing/data/cleaned_2023.csv ml/results/backtest_2023.csv

# 2. Held-out evaluation (#56): reads ml/results/backtest_<year>.csv, needs no raw data
python ml/evaluate_threshold_split.py
python ml/evaluate_threshold_split.py --train 2023 2024 --test 2025   # choose the years explicitly

# 3. Tests
python -m pytest tests/test_backtest_threshold.py tests/test_evaluate_threshold_split.py
```

Step 2 can be re-run from the committed result files without downloading anything. If `ml/results` is regenerated, update the numbers in this document and in `tests/test_evaluate_threshold_split.py`.
