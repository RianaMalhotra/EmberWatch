# Historical detection data: provenance and validation (#46)

Where the fire detections in `public.detections` come from, how they got there, and how to check them.

## Source

| | |
|---|---|
| Provider | NASA FIRMS (Fire Information for Resource Management System), https://firms.modaps.eosdis.nasa.gov/download/ |
| Product | MODIS active-fire **archive** download (standard processing, not near-real-time), CSV |
| Satellites | Terra and Aqua (MODIS instrument on both) |
| Region | Canada |
| Period | 2023-01-02 19:15 UTC to 2025-12-31 22:07 UTC |
| Rows stored | 627,863 |
| Loaded | 2026-10-14, 00:20–00:25 UTC (`created_at`) |

The archive was used rather than near-real-time data because only the archive has the FIRMS `type` column, which the threshold backtest (#19) and the non-wildfire check below need. Raw files are kept out of git (`data-processing/data/` is ignored), so the numbers above are what identifies this load.

## How a row gets into the table

1. **Download** the archive CSV from FIRMS (free Earthdata login).
2. **Clean** with `data-processing/firms_cleaning.py`:
   - `acq_date` + `acq_time` (HHMM, UTC, often without leading zeros, e.g. `5` = 00:05) become one UTC timestamp like `2023-06-04T00:05:00Z`. Impossible times (`2400`, `0060`) and dates (`2023-02-29`) are dropped.
   - MODIS confidence 0–100 gets a class: 0–29 low, 30–79 nominal, 80–100 high.
   - Rows with bad coordinates, timestamps or confidence are dropped and counted by reason. Nothing is guessed.
   - Duplicates (same latitude, longitude, timestamp and satellite) are removed, so overlapping downloads can be combined.
3. **Load** with `data-processing/load_firms_to_db.py`. It inserts with `on conflict on constraint detections_unique do nothing`, so re-running it on the same or an overlapping file only adds rows that are not stored yet.
4. **Validate** with `data-processing/validate_detections.py` (below).

## Duplicate handling

The same rule is applied twice: in the cleaning step (within one batch of files) and by the database (against everything already stored).

`detections_unique` is `unique (latitude, longitude, detected_at, satellite)`. A plain unique constraint treats NULLs as all different, so two copies of a detection with no satellite would both have been stored. Migration `20261031000000_detections_unique_nulls.sql` makes it `unique nulls not distinct`, which matches the cleaning step. The current data has no missing satellites, so this changes nothing for existing rows; it protects future loads (for example a VIIRS file with a missing satellite column).

The same location and time from **different** satellites (Terra and Aqua) are two separate observations and both are kept.

## Validation

```bash
python data-processing/validate_detections.py
```

Read-only. It prints a summary and one line per check, and exits with code 1 if any error check fails.

| Check | Level | Result on 2026-10-31 |
|---|---|---|
| Duplicate detections (missing satellite counted as one value) | error | 0 |
| Detections in the future | error | 0 |
| Detections before MODIS started (2000-11-01) | error | 0 |
| Timestamps with seconds (FIRMS times are whole minutes) | error | 0 |
| Confidence class does not match MODIS score | error | 0 |
| Missing satellite | error | 0 |
| Negative fire radiative power | error | 0 |
| Months with no detections between first and last | warning | 0 (36 of 36 months have data) |
| Non-wildfire detections (FIRMS type 1, 2 or 3) | warning | **682** |
| Unknown fire type | warning | 0 |

Other facts from the same check: 375,567 day and 252,296 night detections; no missing FRP; all points between latitude 42.04–81.90 and longitude −141.00 to −52.84 (inside Canada's bounding box). Monthly counts follow the fire season (low in winter, peaks in July–August each year).

### Open item: non-wildfire detections

FIRMS marks 682 stored rows as type 2 (671, *other static land source*, e.g. industrial heat such as gas flares) or type 3 (11, *offshore*). These are real heat signals but not vegetation fires. They are currently counted in the risk model's nearby fire history and returned by the detections API. Whether to filter them out (`fire_type = 0` or `fire_type is null`) is a model decision for the team; the validator reports them so the number is visible.

## Limits

- Only the 2023–2025 MODIS archive is stored. There is no automatic refresh, so newer fires are not in the table.
- VIIRS (375 m, more detections) has not been loaded. The cleaning code supports it.
- This is a student prototype, not an emergency alert system.

Tests: `tests/test_detection_ingestion_46.py` (timestamps, duplicates across files, re-loading, the unique constraint, and the validator), run in CI by the "Data Processing Tests" job.
