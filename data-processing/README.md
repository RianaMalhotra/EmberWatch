# Data processing

## NASA FIRMS cleaning (`firms_cleaning.py`)

Cleans raw NASA FIRMS active-fire CSVs (MODIS or VIIRS) into one consistent format for model input.

**What it does**
- Converts MODIS (0–100) and VIIRS (`l`/`n`/`h`) confidence into one 0–100 score plus a `low`/`nominal`/`high` class
- Combines `acq_date` and `acq_time` into one UTC ISO timestamp (handles times stored without leading zeros)
- Drops rows with invalid coordinates, dates or confidence, and reports how many were dropped and why
- Removes duplicate detections
- Leaves missing optional values (such as `frp`) empty instead of filling in a made-up number (#27)

**Getting the data**
1. Go to https://firms.modaps.eosdis.nasa.gov/download/ and request an archive download (free NASA Earthdata login).
2. Choose a region (e.g. Canada) and date range, MODIS or VIIRS, CSV format.
3. Save the CSV in `data-processing/data/`. That folder is git-ignored, so raw data is never committed.

Use the **archive** data, not near-real-time: only the archive includes the `type` column needed for the threshold backtest.

**Run**
```bash
python data-processing/firms_cleaning.py data-processing/data/fire_archive.csv data-processing/data/cleaned.csv
```

## Validate stored detections (`validate_detections.py`, issue #46)

Read-only checks on `public.detections` after a load: duplicates, future or malformed timestamps, confidence class vs. score, missing months, and non-wildfire FIRMS types. Exits with code 1 if an error check fails.

```bash
python data-processing/validate_detections.py
```

Source, load history and the latest results: [docs/detection-data-provenance.md](../docs/detection-data-provenance.md).

## Threshold backtest (`ml/backtest_threshold.py`, issue #19)

```bash
python ml/backtest_threshold.py data-processing/data/cleaned.csv data-processing/data/backtest_results.csv
```

It scores thresholds from 0 to 100 (step 5). The "answer key" is **persistence**: a detection counts as a real fire if another detection appears within 2 km between 1 and 72 hours later (fires keep burning; one-off false hotspots don't). It recommends the threshold with the best Youden's J (true-positive rate minus false-positive rate) among thresholds that still keep at least 90% of real fires.

Options: `--radius-km`, `--window-hours`, `--min-recall`, and `--label type` (uses the FIRMS `type` column instead; for Canada ~99.9% of rows are type 0, so it can't separate thresholds).

Put the recommended value in `DEFAULT_MIN_DETECTION_CONFIDENCE` in `backend/config.py`. The threshold can also be overridden at runtime with the `MIN_DETECTION_CONFIDENCE` environment variable.

## Areas and environmental data (`load_environment_to_db.py`, issue #68)

Loads the monitored areas from `areas.csv` plus noon weather and terrain slope from Open-Meteo into Supabase. Details, sources and units: [docs/environmental-data.md](../docs/environmental-data.md).

```bash
python data-processing/load_environment_to_db.py --dry-run
python data-processing/load_environment_to_db.py
```

## Recent fire detections (`fetch_firms_nrt.py`)

Keeps the map current with NASA FIRMS **near-real-time** (NRT) detections, which FIRMS publishes within about 3 hours of each satellite pass. Uses the same cleaning and loading as the archive, so timestamps, confidence classes and duplicate handling match.

```bash
python data-processing/fetch_firms_nrt.py --dry-run     # fetch and print, write nothing
python data-processing/fetch_firms_nrt.py               # last 2 days, MODIS, Canada only
python data-processing/fetch_firms_nrt.py --days 10     # catch up after a gap (max 10)
```

- Needs a free map key in `FIRMS_MAP_KEY` (https://firms.modaps.eosdis.nasa.gov/api/map_key/), plus `DATABASE_URL`. Both can go in `backend/.env`.
- Fetches a box around Canada, then keeps only points inside Canada using `canada_border.py`, a simplified border (to within a few km along the 49th parallel and in the Arctic; up to ~10–15 km off around the Great Lakes and St. Lawrence). The box alone would include the northern US, the Alaska panhandle and western Greenland. FIRMS's country API would clip exactly, but it answers "Invalid API call" to every request. `--keep-outside-canada` keeps everything in the box.
- Default product is `MODIS_NRT`, the same instrument as the stored archive and the #19 threshold backtest. `--source VIIRS_SNPP_NRT` (or NOAA-20/21) is supported.
- Each row's `source` column says which feed it came from, e.g. `NASA FIRMS MODIS_NRT` (archive rows: `NASA FIRMS`).
- NRT rows have no FIRMS `type`, so they can't be checked for non-wildfire heat sources the way archive rows can.
- FIRMS later reprocesses NRT data into the standard archive with slightly different positions. If that archive period is loaded later, the same fire can appear twice (once per source); filter by `source` if that matters.

`.github/workflows/refresh-detections.yml` runs this every 3 hours (2-day window, so a failed run is covered by the next). It needs repository secrets `FIRMS_MAP_KEY` and `DATABASE_URL` (Session pooler). Catch up by hand: *Actions → Refresh fire detections → Run workflow*.

## Tests

```bash
python -m pytest tests          # data-processing and backtest tests (from repo root)
cd backend && python -m pytest  # backend tests, including the threshold filter
```
