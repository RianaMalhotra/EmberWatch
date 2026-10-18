-- Issue #68: terrain inputs for each monitored area.
-- Slope does not change day to day, so it is stored once per area
-- instead of in environmental_observations. NULL means "not measured yet"
-- and is reported as a missing input by the risk model (#28).

alter table public.areas
    add column if not exists province text,
    add column if not exists elevation_m double precision,
    add column if not exists slope_deg double precision
        check (slope_deg between 0 and 90),
    add column if not exists terrain_source text,
    add column if not exists terrain_retrieved_at timestamptz;

comment on column public.areas.slope_deg is
    'Terrain slope in degrees at the area centre, from elevation samples ~250 m N/S/E/W (see docs/environmental-data.md)';
comment on column public.areas.terrain_source is
    'Where elevation_m and slope_deg came from, e.g. open-meteo-elevation (Copernicus DEM GLO-90)';
