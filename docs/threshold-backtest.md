# Detection confidence threshold: backtest results (#19) and held-out evaluation (#56)

**Chosen value:** `DEFAULT_MIN_DETECTION_CONFIDENCE = 20` in `backend/config.py` (provisional; the held-out and burned-area checks below found no evidence that it improves detection quality).
It can be overridden with the `MIN_DETECTION_CONFIDENCE` environment variable.

### How the threshold is used in EmberWatch

In the current detection pipeline, this threshold is a **classification boundary**, not a blanket filter that removes observations:

- Valid detections with confidence at or above the threshold are classified as `potential_wildfire`.
- Valid detections below the threshold are retained and classified as `low_confidence`.
- Invalid or unavailable observations are handled separately and are not assigned fabricated confidence values.

The `/api/detections` endpoint can therefore return both `potential_wildfire` and `low_confidence` records. The threshold also affects the risk model's nearby-detection count: only stored detections meeting the configured threshold contribute to that factor.

The backtests below evaluate how well confidence thresholds separate the study's proxy labels. They do **not** establish that the application removes false detections or that a threshold of 20 improves real-world wildfire detection accuracy.

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

### Interpretation

The held-out 2025 evaluation provides little evidence that the confidence threshold materially improves detection quality:

- At threshold 20, precision was approximately **0.792**, compared with **0.789** without the threshold.
- This is an improvement of only about **0.3 percentage points**.
- Recall was **0.889**, while the false-positive rate remained high at **0.874**.
- The leave-one-year-out results also show that the selected threshold does not consistently achieve the intended 90% recall target. The selected threshold met the 90% recall target in two of the three held-out years, but fell short in 2025 (88.9%).

The additional NBAC burned-area comparison gives a similar caution: threshold 20 removes a comparable proportion of detections inside and outside the buffered burned-area polygons. It does not demonstrate reliable separation between detections associated with burned areas and those outside them.

These findings support treating 20 as a provisional operational classification threshold, not as a validated optimum. They do not establish that higher confidence thresholds are better for the application: increasing the threshold can also discard genuine fire observations.

2023 trade-off across thresholds (share kept):

| Threshold | 0 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Real fires | 1.00 | 0.93 | 0.91 | 0.88 | 0.82 | 0.76 | 0.69 | 0.60 | 0.49 | 0.37 | 0.24 |
| One-off hotspots | 1.00 | 0.90 | 0.87 | 0.83 | 0.76 | 0.68 | 0.58 | 0.48 | 0.36 | 0.24 | 0.14 |

## Check against official burned-area maps (#56)

The persistence answer key above is a proxy. `ml/evaluate_against_nbac.py` adds an independent one: the **National Burned Area Composite (NBAC)** from Natural Resources Canada, polygons of where wildfires actually burned, mapped after the fact (https://cwfis.cfs.nrcan.gc.ca/downloads/nbac/).

**Method**

1. For one year, load that year's NBAC polygons (`NBAC_<year>_<date>.zip`, a shapefile in EPSG:3978) and the cleaned FIRMS detections from the same year.
2. Label a detection **inside** if it lies within 1 km of a polygon (about one MODIS pixel; `--buffer-km` changes it), otherwise **outside**. Only location and year are used. NBAC's date fields are not, because some are derived from satellite hotspots and would make the check partly circular.
3. Score the thresholds exactly as the backtest does and write `ml/results/nbac_<year>.csv`, in the same format as `backtest_<year>.csv`.
4. `python ml/evaluate_threshold_split.py --labels nbac` then runs the same held-out evaluation on these labels (choose on training years, score on a held-out year) and writes `ml/results/threshold_split_evaluation_nbac.csv`.

**How to run** (the map libraries are only needed for this check, not for the app or CI):

```bash
pip install -r ml/requirements-nbac.txt
# 1.The detections. The raw and cleaned FIRMS files are not in git, but the same rows are in the
#database. This read-only export needs DATABASE_URL in backend/.env and writes
#data-processing/data/detections_<year>.csv. Check the counts against the Data table above.
python data-processing/export_detections.py 2023 2024 2025
# 2.The burned areas: download NBAC_2023_*.zip, NBAC_2024_*.zip and NBAC_2025_*.zip from the NBAC
#folder above into data-processing/data/
# 3.Per year, then the held-out evaluation:
python ml/evaluate_against_nbac.py data-processing/data/detections_2023.csv data-processing/data/NBAC_2023_20260513.zip --year 2023
# repeat for 2024 and 2025, then:
python ml/evaluate_threshold_split.py --labels nbac
```

Instead of the database export, a cleaned FIRMS file from `firms_cleaning.py` (for example `cleaned_2023.csv`) works too.

Allow a few minutes per year: big fire years have very detailed polygons.

**What "inside" and "outside" mean.** Inside is a stronger indication that a detection is associated with a burned area than the persistence proxy provides. Outside is **not** proof of a false alarm: small or unmapped fires and other heat sources (such as agricultural burning) also end up outside. The false-positive rate from this check is therefore overstated, and precision understated.

**Results** (1 km buffer; `ml/results/nbac_<year>.csv`)

| Year | Burned-area polygons | Detections inside a burned area | Share inside |
|---|---|---|---|
| 2023 | 2,244 | 314,840 of 324,003 | 97.2% |
| 2024 | 1,970 | 140,087 of 147,547 | 94.9% |
| 2025 | 1,955 | 148,641 of 156,313 | 95.1% |

The persistence proxy called only 79-81% of the same detections real, so it labels many detections that sit inside burned areas as one-offs, as its limitations below say.

**The deployed threshold of 20 under both answer keys.** No threshold is chosen on any year here, so every year is a fair test (`python ml/evaluate_threshold_split.py --report-threshold 20`, and again with `--labels nbac`). "Drops" is the share of that group the filter removes: real fires or detections inside burned areas, and one-off hotspots or detections outside.

| Year | Answer key | Precision, no filter → at 20 | Recall | Drops real / inside | Drops one-off / outside |
|---|---|---|---|---|---|
| 2023 | persistence proxy | 0.814 → 0.820 | 0.911 | 8.9% | 12.7% |
| 2023 | burned-area map | 0.972 → 0.972 | 0.904 | 9.6% | 9.5% |
| 2024 | persistence proxy | 0.812 → 0.815 | 0.908 | 9.2% | 11.0% |
| 2024 | burned-area map | 0.949 → 0.949 | 0.904 | 9.6% | 8.5% |
| 2025 | persistence proxy | 0.789 → 0.792 | 0.889 | 11.1% | 12.6% |
| 2025 | burned-area map | 0.951 → 0.950 | 0.884 | 11.6% | 9.1% |

**Burned-area labels, 2025, across thresholds:**

| Threshold | Precision | Recall | False-positive rate | Youden's J |
|---|---|---|---|---|
| 0 | 0.951 | 1.000 | 1.000 | 0.000 |
| 20 | 0.950 | 0.884 | 0.909 | -0.024 |
| 50 | 0.953 | 0.739 | 0.702 | 0.038 |
| 70 | 0.964 | 0.583 | 0.424 | 0.158 |
| 85 | 0.976 | 0.427 | 0.203 | 0.223 |
| 100 | 0.984 | 0.238 | 0.075 | 0.162 |

What this shows:

- **Threshold 20 does little under either key.** It removes nearly the same share of both groups (about 9-13%), so precision moves by less than one percentage point: up 0.3-0.6 points with persistence labels, and flat to down 0.1 points with burned-area labels.
- **The 90% recall target held in 2023 and 2024 but not in 2025**, under both keys (recall 0.889 with persistence labels, 0.884 with burned-area labels).
- **Burned-area labels choose "no filter" (threshold 0) in every held-out fold.** At every threshold that still keeps 90% of detections inside burned areas (up to 10-20, depending on the year), the filter keeps a larger share of the outside detections than the inside ones (Youden's J is negative), so keeping everything wins.
- **Higher thresholds do separate the groups, but at a large cost.** Youden's J turns positive between thresholds 25 and 40 and peaks at 85 in all three years (0.21, 0.28, 0.22). At 85 only 42-44% of detections inside burned areas are kept, while precision rises from 0.95-0.97 to 0.98-0.99. For early detection, where missing a fire is worse than a false alarm, that trade is hard to justify.

**What this means for the setting.** Both answer keys agree that confidence is a weak filter at 20, and nothing here shows that 20 improves detection quality. In the app, detections below the threshold are not dropped: they are classified `low_confidence` and drawn differently on the map. So the practical effect of the setting is which marker style a detection gets. Keeping 20, lowering it, or showing confidence as a gradient instead of a single cut-off is a team decision. The setting stays provisional.

## Limitations

- **Confidence alone is a weak filter.** Real fires and one-off hotspots are dropped at nearly the same rate as the threshold rises. The best separation (J = 0.13 at 80) would discard half of all real fires. Precision only rises from 0.81 to 0.88 across the full range.
- **No validated accuracy is claimed.** Without field-verified ground truth, precision, recall and false-positive figures are measured against proxy labels: the persistence-based labels or the NBAC burned-area comparison, depending on the evaluation. Treat them as estimates of how the filter behaves, not as the real-world accuracy of wildfire detection.
- **Neither answer key is ground truth, but they agree on the main conclusion.** The cut-off at 20 changes little under both, so rely on that finding and not on the exact precision and recall values. Precision with burned-area labels is high (0.95-0.97) partly because almost every detection falls in a mapped burn.
- **Burned-area labels have their own limits.** NBAC is a composite of several sources and its attributes include hotspot-based dates, so it may not be fully independent of the satellite detections. Check its metadata for how much of it is hotspot-based. Fires that burn across New Year are matched only to polygons of the detection's own calendar year.
- **The split is small.** There are three seasons, so the main split has a single test season (2025) and the leave-one-year-out check has only three folds. Thresholds are scored in steps of 5. The held-out figures give a rough idea of stability, not a tight confidence interval.
- **Proxy labels are not ground truth.** Detection persistence and overlap with burned-area polygons provide useful comparison signals, but neither proves that an individual satellite observation is a wildfire. Detections outside a burned-area polygon are not necessarily false detections.
- **Next step:** combine confidence with other signals (repeat detection, FRP, land cover), or validate against official burned-area perimeters (e.g. NBAC).

## Reproduce

```bash
# 1. Per year (needs the downloaded FIRMS file; repeat for 2024 and 2025)
python data-processing/firms_cleaning.py data-processing/data/modis_2023_Canada.csv data-processing/data/cleaned_2023.csv
python ml/backtest_threshold.py data-processing/data/cleaned_2023.csv ml/results/backtest_2023.csv

# 2. Held-out evaluation (#56): reads ml/results/backtest_<year>.csv, needs no raw data
python ml/evaluate_threshold_split.py
python ml/evaluate_threshold_split.py --train 2023 2024 --test 2025   # choose the years explicitly

# 3. Optional: the burned-area check (see the section above; needs ml/requirements-nbac.txt)
python data-processing/export_detections.py 2023 2024 2025
python ml/evaluate_against_nbac.py data-processing/data/detections_2023.csv data-processing/data/NBAC_2023_20260513.zip --year 2023
python ml/evaluate_threshold_split.py --labels nbac --report-threshold 20

# 4. Tests
python -m pytest tests/test_backtest_threshold.py tests/test_evaluate_threshold_split.py tests/test_evaluate_against_nbac.py tests/test_evaluate_against_nbac_maps.py tests/test_export_detections.py
```

Step 2 can be re-run from the committed result files without downloading anything. If `ml/results` is regenerated, update the numbers in this document and in `tests/test_evaluate_threshold_split.py`.
