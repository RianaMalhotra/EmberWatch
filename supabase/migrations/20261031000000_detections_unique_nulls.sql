-- Issue #46: make the duplicate check work when satellite is missing.
-- A normal UNIQUE constraint treats NULLs as all different, so two copies of
-- the same detection with no satellite would both be stored, and the loader's
-- "on conflict do nothing" would not skip them. NULLS NOT DISTINCT (PostgreSQL
-- 15+) treats a missing satellite as one value, which matches the duplicate
-- check in data-processing/firms_cleaning.py.
-- Safe to apply to the current data: it has no NULL satellites and no
-- duplicates (checked with data-processing/validate_detections.py).

alter table public.detections
    drop constraint detections_unique,
    add constraint detections_unique
        unique nulls not distinct (latitude, longitude, detected_at, satellite);
