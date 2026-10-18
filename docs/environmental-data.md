# Environmental data (issue #68)

`data-processing/load_environment_to_db.py` fills the `areas` and `environmental_observations` tables so the risk heatmap and area detail panel show real factors instead of placeholders.

## Run it

Apply `supabase/migrations/20261018000000_area_terrain.sql` first (it adds the terrain columns to `areas`). Then, from the repository root:

```bash
python data-processing/load_environment_to_db.py --dry-run                 # fetch and print, write nothing
python data-processing/load_environment_to_db.py                           # yesterday
python data-processing/load_environment_to_db.py --date 2026-08-15 --days 3
```

`DATABASE_URL` is read from `backend/.env`. Re-running is safe: areas are updated by name and observations already stored are skipped. All data is fetched before anything is written, so a network error never leaves half a load in the database. Add `--skip-terrain` to fetch weather only.

## Areas

`data-processing/areas.csv` lists the monitored areas: name, province, the town-centre coordinates (approximate), and **why each one was chosen**. Most are places with recent major wildfires (Kelowna 2023, Lytton 2021, Jasper 2024, Fort McMurray 2016, Yellowknife 2023, …). Ottawa is a low-risk comparison. To add an area, add a row and re-run the script.

## Where each value comes from

| Column | Source | How it is computed |
|---|---|---|
| `temperature_c` | Open-Meteo, `temperature_2m` (°C) | value at 12:00 local time |
| `relative_humidity_pct` | Open-Meteo, `relative_humidity_2m` (%) | value at 12:00 local time |
| `wind_speed_kmh` | Open-Meteo, `wind_speed_10m` (km/h) | value at 12:00 local time |
| `precipitation_mm` | Open-Meteo, `precipitation` (mm) | sum of the 24 hours ending at 12:00 local time |
| `vegetation_index` | none yet | stays `NULL` (see below) |
| `areas.elevation_m` | Open-Meteo Elevation API (Copernicus DEM GLO-90, 90 m) | elevation at the area centre |
| `areas.slope_deg` | same | from elevations 250 m north, south, east and west: `atan(√(dz/dx² + dz/dy²))` |

Noon values and the 24-hour rain total follow the Canadian Fire Weather Index convention. `observed_at` is that local noon converted to UTC.

Days at least 6 days old come from the Open-Meteo **historical archive** (ERA5 reanalysis, `source = open-meteo-archive`); newer days come from the **forecast** API's recent past (`source = open-meteo-forecast`). Open-Meteo is free and needs no API key.

## Missing and invalid values (#27, #28)

- Nothing is filled in or guessed. If a value is missing in the response, or outside the allowed range (same limits as the table CHECK constraints), it is stored as `NULL` and a warning is printed.
- If any hour of the 24-hour rain window is missing, `precipitation_mm` is `NULL` rather than a partial total.
- **NDVI (`vegetation_index`) has no source yet**, so every area is scored with `vegetation_index` listed in `missing_inputs` (`is_complete = false`, coverage 0.90). Adding a vegetation source (for example MODIS NDVI) is a follow-up.

## Verify the load

Run these in the Supabase SQL Editor (or `psql`) after loading:

```sql
-- every area, its terrain and how many observations it has
select a.name, a.province, a.slope_deg, a.elevation_m, count(e.id) as observations,
       max(e.observed_at) as latest
from public.areas a
left join public.environmental_observations e on e.area_id = a.id
group by a.id order by a.name;

-- missing values per column (NULL = unavailable, never invented)
select source, count(*) as rows,
       count(*) - count(temperature_c)         as missing_temperature,
       count(*) - count(relative_humidity_pct) as missing_humidity,
       count(*) - count(wind_speed_kmh)        as missing_wind,
       count(*) - count(precipitation_mm)      as missing_precipitation,
       count(*) - count(vegetation_index)      as missing_ndvi
from public.environmental_observations group by source;
```

Then open `http://127.0.0.1:5000/api/risk-areas`: each area should have `environmental_factors` filled in, a `slope_deg`, and `missing_inputs` containing only `vegetation_index`.

## Attribution

- Weather: Open-Meteo (Zippenfenig, P. 2023, doi:10.5281/zenodo.7970649). Archive data: "Generated using Copernicus Climate Change Service information" (ERA5).
- Elevation: Copernicus DEM GLO-90, © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA (doi:10.5270/ESA-c5d3d65).
