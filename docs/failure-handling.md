# Failure handling (Sprint 4, #49; builds on #4, #24–#28)

Rule for every layer: **if data is missing or a service fails, say so. Never show a made-up detection or risk score.**

## What the user sees

| Failure | API answer | UI state | Tests |
|---|---|---|---|
| Database unreachable, not configured, or a query cancelled | `503` (`/api/risk-areas`: `status: "error"`; `/api/detections`: `status: "unavailable"`), no data, no connection details | Red "Risk data unavailable" / "Detections unavailable" message with **Try again** | `backend/tests/test_failure_handling.py`, `test_db_timeouts.py` |
| Fire-history lookup fails | `200` + `warnings: [history_unavailable]`; scores marked incomplete | Amber notice; dashed marker outline | `test_failure_handling.py` |
| Model raises for one area | `200`; that area has `risk_score: null`, `processing_error: true` | Grey marker, "score could not be calculated" | `test_failure_handling.py`, `App.test.jsx` |
| Environmental inputs missing | Score only if ≥ 50% of model weight is real data; `missing_inputs` lists the rest | "Unavailable" per factor; incomplete or grey marker | `backend/tests/test_no_fabrication.py` (every combination of missing inputs) |
| Detection row invalid | Row left out and counted under `gaps` / `counts.unavailable` | "N could not be shown" in the summary line | `test_no_fabrication.py`, `test_detection_pipeline.py` |
| Weather is old, or an area has no observation time | n/a (`observed_at` is `null` when there is none) | `DataFreshness` banner says how old the weather is (#99); the details panel shows "Weather observation time unavailable" when an area has none | `dataFreshness.app.test.jsx`, `riskFormat.test.js`, `App.test.jsx` |
| Backend slow or silent | Browser gives up after 15 s | "The server took too long to respond" + retry | `failureHandling.test.js` |
| Reply is not JSON / wrong shape | n/a | "Invalid … data received" | `failureHandling.test.js` |
| One malformed record in a valid reply | n/a | Record dropped; notice "N area(s) were left out" | `failureHandling.test.js` |
| Rendering crash in the map or details panel | n/a | "The map and area details could not be displayed" with **Try again**; header, status messages and Report a Fire keep working | `ErrorBoundary.test.jsx`, `App.test.jsx` |

The risk-area and detection requests are independent: either can fail while the other still shows (`App.test.jsx`, "Sprint 4 failure isolation").

## External feed: Open-Meteo (`data-processing/load_environment_to_db.py`)

- **Timeout / unreachable / HTTP error** (`OSError`): the run stops with "Could not reach Open-Meteo … Nothing was written".
- **Malformed reply** (not JSON, not an object, cut off mid-reply, `{"error": true}`, wrong elevation count): `DataSourceError`, the run stops with "Open-Meteo returned unusable data … Nothing was written".
- **Missing values** inside a good reply are stored as `NULL`; the risk model then reports them as missing inputs. A reply whose UTC offset is missing or not a number skips that day instead of assuming UTC, because that would give a wrong `observed_at`.
- All data is fetched before the first database write, so a failure never leaves a half-loaded run.

Tests: `tests/test_load_environment_failures.py`.

## Optional setting

`DB_STATEMENT_TIMEOUT_MS` (see `backend/.env.example`) cancels any single query that runs longer than the given time, so a stuck query becomes a `503`. It is off by default because some Supabase poolers reject connection startup options; try it against your connection string before relying on it.
