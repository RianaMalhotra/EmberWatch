# Acceptance traceability and test evidence ([#66](https://github.com/RianaMalhotra/EmberWatch/issues/66))

This matrix maps every acceptance criterion of the selected user stories to the issue that delivered it, the code and pull request, the automated test or recorded evidence, and a demo step a teammate can repeat. It describes **what is implemented on `main`**, not what was planned; anything missing or only partly done is marked as a gap.

- **Snapshot:** `main` at commit `6dcb585` (Nov 26, 2026), after [#105](https://github.com/RianaMalhotra/EmberWatch/pull/105), [#112](https://github.com/RianaMalhotra/EmberWatch/pull/112) and [#113](https://github.com/RianaMalhotra/EmberWatch/pull/113) were merged.
- **Criteria source:** [`docs/requirements.md`](requirements.md), section *Selected Candidate Requirements*.
- **Final handoff:** [#62](https://github.com/RianaMalhotra/EmberWatch/issues/62) should link to this file.

**Status legend**

| Status | Meaning |
|---|---|
| ✅ Met | Implemented on `main` and backed by an automated test or recorded evidence |
| 🟡 Partial | Implemented in part, implemented differently from the criterion, or implemented but not yet measured the way the criterion asks |
| ❌ Gap | Not implemented or not verified |
| ⏸ Deferred | Story intentionally postponed |

> **Production caveat.** Everything below was verified locally (automated tests, local production build). Live checks on the deployed site are separate. On Nov 26, 2026, migrations 3–5 (`detections_unique_nulls`, `fire_reports`, `report_moderation`) were applied to the production Supabase project `ash-detectives`, and `scripts/check_migrations.py` passes all 11 checks ([#114](https://github.com/RianaMalhotra/EmberWatch/pull/114)). However, the Render backend is still running commit `65a9f4c` (Oct 27, 2026), so the reporting and moderation endpoints are **not live yet**, and public reporting stays disabled in Vercel until Render is redeployed and smoke-checked ([#61](https://github.com/RianaMalhotra/EmberWatch/issues/61)).

## How to reproduce the test results

Run from the repository root. Python 3.11+ and Node 20+ as in CI (`.github/workflows/tests.yml`). No database credentials are needed: the tests use mocks and fixtures.

```bash
pip install -r backend/requirements.txt

# 1. Backend (same coverage gate as CI)
cd backend
python -m pytest -q --cov=services.detection_pipeline --cov=services.detection_validation \
  --cov=services.detection_filter --cov=services.risk_scoring --cov=services.report_validation \
  --cov=services.report_store --cov=services.client_ip --cov-report=term --cov-fail-under=80
cd ..

# 2. Data processing and ML evaluation
python -m pytest tests -q

# 3. Frontend
cd frontend
npm ci
npm test -- --run
```

On Windows PowerShell, set `$env:TZ="America/Toronto"` before `npm test`: one date test assumes a North American time zone.

**Results on `6dcb585` (run Nov 26, 2026):**

| Suite | Result |
|---|---|
| Backend (`backend/tests`) | **499 passed**; coverage of the 7 critical service modules **99%** (CI requires ≥ 80%) |
| Data processing / ML (`tests`) | **257 passed, 4 skipped** (3 need a live PostGIS database via `TEST_DATABASE_URL`, 1 needs the optional `geopandas` package) |
| Frontend (`frontend/src`, Vitest) | **30 files, 240 passed, 1 skipped** |

**Demo setup** (for the *Demo step* column): run the backend (`cd backend && python app.py`) and frontend (`cd frontend && npm run dev`) as described in the README, with `VITE_API_BASE_URL` pointing at the backend. Demo steps start from the home page unless they say otherwise.

## Summary

| Story | Criteria | ✅ Met | 🟡 Partial | ❌ Gap | ⏸ Deferred |
|---|---|---|---|---|---|
| [#2 Fire & Risk Information Dashboard](#2-fire--risk-information-dashboard) ([#2](https://github.com/RianaMalhotra/EmberWatch/issues/2)) | 9 | 9 | 0 | 0 | 0 |
| [#3 Wildfire Risk Heatmap](#3-wildfire-risk-heatmap) ([#3](https://github.com/RianaMalhotra/EmberWatch/issues/3)) | 4 | 3 | 1 | 0 | 0 |
| [#4 Reliable Handling of Data and Service Failures](#4-reliable-handling-of-data-and-service-failures) ([#4](https://github.com/RianaMalhotra/EmberWatch/issues/4)) | 6 | 5 | 1 | 0 | 0 |
| [#5 Explainable Risk Factors](#5-explainable-risk-factors) ([#5](https://github.com/RianaMalhotra/EmberWatch/issues/5)) | 5 | 3 | 2 | 0 | 0 |
| [#6 Usability / Understandability](#6-usability--understandability) ([#6](https://github.com/RianaMalhotra/EmberWatch/issues/6)) | 5 | 1 | 2 | 2 | 0 |
| [#8 Early-Warning Simulation](#8-early-warning-simulation) ([#8](https://github.com/RianaMalhotra/EmberWatch/issues/8)) | 1 | 0 | 0 | 0 | 1 |
| [#9 Responsive Interactive Map Performance](#9-responsive-interactive-map-performance) ([#9](https://github.com/RianaMalhotra/EmberWatch/issues/9)) | 7 | 2 | 4 | 1 | 0 |
| [#10 Wildfire Detection and Confidence Scoring](#10-wildfire-detection-and-confidence-scoring) ([#10](https://github.com/RianaMalhotra/EmberWatch/issues/10)) | 7 | 7 | 0 | 0 | 0 |
| [#12 Maintainable and Modular Architecture](#12-maintainable-and-modular-architecture) ([#12](https://github.com/RianaMalhotra/EmberWatch/issues/12)) | 6 | 3 | 3 | 0 | 0 |
| [#13 Report a Fire and Fire Lifecycle History](#13-report-a-fire-and-fire-lifecycle-history) ([#13](https://github.com/RianaMalhotra/EmberWatch/issues/13)) | 25 | 15 | 9 | 1 | 0 |
| **Total** | **75** | **48** | **22** | **4** | **1** |

Most of the core monitoring workflow (#2, #3, #4, #10) is met and tested. The open items are concentrated in measured targets that were never run (#9 load and API tests, #6 five-participant study), ranking in the explanations (#5), and the reporting lifecycle beyond storage and moderation (#13).

## #2 Fire & Risk Information Dashboard

Story: [#2](https://github.com/RianaMalhotra/EmberWatch/issues/2)

| # | Criterion (short) | Issue(s) | Code / PR | Test or evidence | Demo step | Status |
|---|---|---|---|---|---|---|
| 2.1 | Dashboard shows active or historical detections | [#17](https://github.com/RianaMalhotra/EmberWatch/issues/17), [#18](https://github.com/RianaMalhotra/EmberWatch/issues/18), [#43](https://github.com/RianaMalhotra/EmberWatch/issues/43) | `App.jsx`, `DetectionLayer.jsx`, `GET /api/detections`; [#67](https://github.com/RianaMalhotra/EmberWatch/pull/67), [#91](https://github.com/RianaMalhotra/EmberWatch/pull/91), [#105](https://github.com/RianaMalhotra/EmberWatch/pull/105) | `App.test.jsx`: *shows classified detections with location, timestamp, and confidence* | Explore → flame markers on the map | ✅ |
| 2.2 | Select an individual detection or a predefined region | [#23](https://github.com/RianaMalhotra/EmberWatch/issues/23) | `App.jsx` selection handlers, monitored-areas list; [#69](https://github.com/RianaMalhotra/EmberWatch/pull/69), [#90](https://github.com/RianaMalhotra/EmberWatch/pull/90) | `App.test.jsx`: *opens the selected detection details when a satellite marker is clicked*, *shows environmental factors when a risk area is clicked*; `dashboardUi.test.jsx`: *selects an area from the list without touching the map* | Click a flame, then a risk circle, then **Browse monitored areas** | ✅ |
| 2.3 | Selected detection/region shows its location | [#23](https://github.com/RianaMalhotra/EmberWatch/issues/23) | Details panel and popup (coordinates) | `App.test.jsx`: *shows classified detections with location, timestamp, and confidence* | Click a flame → *Location* | ✅ |
| 2.4 | Detection time shown when available | [#18](https://github.com/RianaMalhotra/EmberWatch/issues/18) | `detectionFormat.js`; popup *Detected:* | Same test as 2.3 | Click a flame → *Detected* | ✅ |
| 2.5 | Model confidence and risk level shown when available | [#10](https://github.com/RianaMalhotra/EmberWatch/issues/10), [#3](https://github.com/RianaMalhotra/EmberWatch/issues/3) | Popup *Confidence*; area panel risk level/score | `App.test.jsx`: *shows environmental factors when a risk area is clicked* | Click a flame (confidence), then a risk circle (risk level) | ✅ |
| 2.6 | Relevant environmental conditions shown when available | [#23](https://github.com/RianaMalhotra/EmberWatch/issues/23), [#68](https://github.com/RianaMalhotra/EmberWatch/issues/68) | Area panel factor rows (temperature, humidity, wind, precipitation, …); [#73](https://github.com/RianaMalhotra/EmberWatch/pull/73) | `App.test.jsx`: *shows environmental factors when a risk area is clicked* | Click a risk circle → factor list | ✅ |
| 2.7 | Missing information shown as unavailable, never fabricated | [#20](https://github.com/RianaMalhotra/EmberWatch/issues/20), [#28](https://github.com/RianaMalhotra/EmberWatch/issues/28) | *Unavailable* labels, *Missing inputs* list; [#33](https://github.com/RianaMalhotra/EmberWatch/pull/33), [#75](https://github.com/RianaMalhotra/EmberWatch/pull/75) | `App.test.jsx`: *does not present a stale risk level when the score is missing*, *says so when an area has no weather observation, instead of showing nothing*; `test_no_fabrication.py` | Click an area → *Vegetation Index: Unavailable* | ✅ |
| 2.8 | Region with no data clearly says no information is available | [#28](https://github.com/RianaMalhotra/EmberWatch/issues/28) | Searched unmonitored place: *Risk score: Not available — this location is outside the currently monitored risk assessments* | `App.test.jsx`: *explains when an area has no risk score*; manual check in the [#115](https://github.com/RianaMalhotra/EmberWatch/pull/115) heuristic review (Regina) | Search **Regina** → *Risk score: Not available* | ✅ (usability note: P3 read an empty result as "still loading", see `map-performance.md` finding 9) |
| 2.9 | Selecting a different detection/region updates the information | [#23](https://github.com/RianaMalhotra/EmberWatch/issues/23) | Selection state in `App.jsx` | `App.test.jsx`: *supports the complete wildfire monitoring workflow*, *clears the selected area's details* | Click two different areas in turn | ✅ |

## #3 Wildfire Risk Heatmap

Story: [#3](https://github.com/RianaMalhotra/EmberWatch/issues/3)

| # | Criterion (short) | Issue(s) | Code / PR | Test or evidence | Demo step | Status |
|---|---|---|---|---|---|---|
| 3.1 | Risk level shown for every area with enough input data | [#22](https://github.com/RianaMalhotra/EmberWatch/issues/22), [#44](https://github.com/RianaMalhotra/EmberWatch/issues/44) | `GET /api/risk-areas`, risk circles + zones (`riskZone.js`, `RiskLegend.jsx`); [#32](https://github.com/RianaMalhotra/EmberWatch/pull/32), [#81](https://github.com/RianaMalhotra/EmberWatch/pull/81), [#99](https://github.com/RianaMalhotra/EmberWatch/pull/99) | `App.test.jsx`: *displays the map and risk areas returned by the API*, *shades valid risk zones without fabricating values for unscored areas (#44)* | Explore → coloured circles for the 13 monitored areas | ✅ |
| 3.2 | Selecting an area shows its risk level and contributing factors, matching stored model output | [#23](https://github.com/RianaMalhotra/EmberWatch/issues/23), [#57](https://github.com/RianaMalhotra/EmberWatch/issues/57) | Area details panel; [#69](https://github.com/RianaMalhotra/EmberWatch/pull/69), [#102](https://github.com/RianaMalhotra/EmberWatch/pull/102) | `App.test.jsx`: *shows environmental factors when a risk area is clicked*; `test_risk_validation_57.py::test_api_and_model_agree` | Click **Prince Albert** → score and factors | ✅ |
| 3.3 | Areas with missing inputs marked incomplete/unavailable, never fabricated | [#20](https://github.com/RianaMalhotra/EmberWatch/issues/20), [#28](https://github.com/RianaMalhotra/EmberWatch/issues/28) | Dashed (incomplete) and grey (unscored) circles; `risk_scoring.py` coverage rule; [#75](https://github.com/RianaMalhotra/EmberWatch/pull/75) | `App.test.jsx`: *draws incomplete areas dashed and unscored areas grey (#28)*; `test_risk_validation_57.py::test_coverage_below_minimum_gives_no_score_or_level` | Legend → *Dashed outline: incomplete* | ✅ |
| 3.4 | Interface identifies the factors that contributed **most strongly**, without claiming causation | [#45](https://github.com/RianaMalhotra/EmberWatch/issues/45), [#57](https://github.com/RianaMalhotra/EmberWatch/issues/57) | *How the risk estimate is calculated* lists every factor with base weight and sub-score; non-causal wording; [#80](https://github.com/RianaMalhotra/EmberWatch/pull/80), [#102](https://github.com/RianaMalhotra/EmberWatch/pull/102) | `dashboardUi.test.jsx`: *keeps the model explanation collapsed until asked for*; `test_risk_validation_57.py::test_weights_are_documented_values` | Click an area → **View Risk Details** | 🟡 Non-causal wording ✅; factors are listed in a **fixed order, not ranked** by their contribution to this prediction |

## #4 Reliable Handling of Data and Service Failures

Story: [#4](https://github.com/RianaMalhotra/EmberWatch/issues/4)

| # | Criterion (short) | Issue(s) | Code / PR | Test or evidence | Demo step | Status |
|---|---|---|---|---|---|---|
| 4.1 | Application stays accessible when one external data source or service fails | [#25](https://github.com/RianaMalhotra/EmberWatch/issues/25), [#49](https://github.com/RianaMalhotra/EmberWatch/issues/49) | Independent loading of risk and detection feeds; `ErrorBoundary.jsx`; [#79](https://github.com/RianaMalhotra/EmberWatch/pull/79), [#100](https://github.com/RianaMalhotra/EmberWatch/pull/100) | `App.test.jsx`: *keeps showing risk areas when the detections feed fails*, *keeps showing detections when the risk feed fails, without inventing risk areas* | DevTools → block `/api/detections` → risk map still works | ✅ |
| 4.2 | 100% of tested unavailable values shown as unavailable, never fabricated | [#20](https://github.com/RianaMalhotra/EmberWatch/issues/20), [#28](https://github.com/RianaMalhotra/EmberWatch/issues/28) | *Unavailable* labels; API never invents values | `test_no_fabrication.py` (3 tests); `failureHandling.test.js`: *never turns a dropped record into a made-up area* | Any area → missing inputs | ✅ |
| 4.3 | An API, data-source or model failure does not crash the whole app | [#26](https://github.com/RianaMalhotra/EmberWatch/issues/26) | Per-area model isolation in `_build_risk_areas`; `ErrorBoundary` | `test_failure_handling.py::test_model_failure_for_one_area_does_not_break_the_others`; `ErrorBoundary.test.jsx`; `App.test.jsx`: *keeps the rest of the page usable when the map section crashes while rendering* | — | ✅ |
| 4.4 | Derived outputs with missing required inputs marked incomplete/unavailable | [#28](https://github.com/RianaMalhotra/EmberWatch/issues/28) | Coverage rule in `risk_scoring.py`; dashed/grey areas | `test_failure_handling.py::test_fire_history_failure_still_returns_areas_marked_incomplete`; `App.test.jsx`: *says the score could not be calculated when the model failed for an area (#26)* | Legend → dashed = incomplete | ✅ |
| 4.5 | External feeds retry temporary failures | [#49](https://github.com/RianaMalhotra/EmberWatch/issues/49) | Open-Meteo retry (`load_environment_to_db.py`, `RETRY_DELAYS_S = (5, 20)`); [#106](https://github.com/RianaMalhotra/EmberWatch/pull/106) | `tests/test_load_environment_failures.py` | — | ✅ (supports 4.1) |
| 4.6 | Each failure simulated in the **deployment/test environment** | [#4](https://github.com/RianaMalhotra/EmberWatch/issues/4) | [`docs/failure-handling.md`](failure-handling.md) | Automated tests with mocks; manual request blocking in the [#115](https://github.com/RianaMalhotra/EmberWatch/pull/115) review (search) | — | 🟡 Covered by automated tests; **no recorded run on the deployed site** for each failure type |

## #5 Explainable Risk Factors

Story: [#5](https://github.com/RianaMalhotra/EmberWatch/issues/5)

| # | Criterion (short) | Issue(s) | Code / PR | Test or evidence | Demo step | Status |
|---|---|---|---|---|---|---|
| 5.1 | Top 3 available factors, ranked by per-prediction contribution | [#45](https://github.com/RianaMalhotra/EmberWatch/issues/45) | `frontend/src/utils/riskExplanation.js` (`explainFactors`) returns all 7 factors in weight order | `dashboardUi.test.jsx`: *keeps the model explanation collapsed until asked for* | Click an area → **View Risk Details** | 🟡 **All factors shown, not a ranked top 3**. Contribution = weight × sub-score is available in the API (`factor_scores`) but not used for ranking |
| 5.2 | Documented contribution / explainability method | [#21](https://github.com/RianaMalhotra/EmberWatch/issues/21), [#57](https://github.com/RianaMalhotra/EmberWatch/issues/57) | Weighted index `weighted-index-v1` in `backend/services/risk_scoring.py`; [`docs/risk-model.md`](risk-model.md); [#37](https://github.com/RianaMalhotra/EmberWatch/pull/37), [#102](https://github.com/RianaMalhotra/EmberWatch/pull/102) | `test_risk_validation_57.py::test_score_equals_weighted_factor_scores`, `::test_weights_are_documented_values` | — | ✅ Method documented (weights × sub-scores). Ranking by it is the gap in 5.1 |
| 5.3 | Short explanation of **why this area** got its level, referencing its contributing factors | [#45](https://github.com/RianaMalhotra/EmberWatch/issues/45) | Generic per-factor sentences (`FACTOR_EXPLANATIONS`) | Code review | Click an area → **View Risk Details** | 🟡 Explanations are the same for every area; **no area-specific summary sentence** |
| 5.4 | Unavailable factors identified, never assumed | [#20](https://github.com/RianaMalhotra/EmberWatch/issues/20) | *Unavailable* per factor; *Missing inputs* list | `test_risk_validation_57.py::test_each_missing_factor_is_reported_with_its_coverage`; `App.test.jsx`: *does not present a stale risk level when the score is missing* | Any area → *Vegetation Index: Unavailable* | ✅ |
| 5.5 | Wording describes model contributions, not definitive causes | [#45](https://github.com/RianaMalhotra/EmberWatch/issues/45) | *…increase the model's fire-risk contribution*; *contribute to an experimental risk estimate, not a confirmed fire* | Code review of `riskExplanation.js` | Read the explanation list | ✅ |

## #6 Usability / Understandability

Story: [#6](https://github.com/RianaMalhotra/EmberWatch/issues/6)

| # | Criterion (short) | Issue(s) | Code / PR | Test or evidence | Demo step | Status |
|---|---|---|---|---|---|---|
| 6.1 | ≥ 90% of participants identify the risk level **and** explain confidence correctly (all 5 if 5 are tested) | [#48](https://github.com/RianaMalhotra/EmberWatch/issues/48), [#60](https://github.com/RianaMalhotra/EmberWatch/issues/60) | Usability study in [`docs/map-performance.md`](map-performance.md#usability-tasks-risk-vs-detection-confidence); [#105](https://github.com/RianaMalhotra/EmberWatch/pull/105) | 3 participants: risk level 3/3 ✅; confidence 1/3 (P3, with the popup added in [#105](https://github.com/RianaMalhotra/EmberWatch/pull/105)). P1 and P2 did not separate confidence from risk | — | ❌ **Not met**: 3 participants instead of ≥ 5, and only 1 of 3 explained confidence correctly. Final test planned in [#60](https://github.com/RianaMalhotra/EmberWatch/issues/60) |
| 6.2 | Participants not developers, no remote-sensing/GIS/wildfire-modelling background | [#48](https://github.com/RianaMalhotra/EmberWatch/issues/48) | Recruitment notes in `map-performance.md` | P1 Arts & Science, P2 Mechanical Engineering, P3 first-year Arts & Science; none worked on the app | — | 🟡 Not developers ✅; GIS background was **not formally screened or recorded** |
| 6.3 | Scenarios: high risk + high confidence, high risk + low (~40%) confidence, missing data | [#60](https://github.com/RianaMalhotra/EmberWatch/issues/60) | — | Live data had no High-risk area during testing (P1: "there's no red") | — | ❌ **The defined scenarios were not used**; they need prepared views or fixture data |
| 6.4 | Risk-level task: identifies the displayed category | [#48](https://github.com/RianaMalhotra/EmberWatch/issues/48) | Area panel risk level | Task 1: 3/3 ✅ | Click an area | ✅ (for the 3 participants tested) |
| 6.5 | Confidence task: says confidence is the model's confidence in its own output, not a probability or guarantee | [#48](https://github.com/RianaMalhotra/EmberWatch/issues/48) | Popup explanation added in [#105](https://github.com/RianaMalhotra/EmberWatch/pull/105) | Task 3: P1 ⚠️/❌, P2 ⚠️/❌, P3 ✅ on the [#105](https://github.com/RianaMalhotra/EmberWatch/pull/105) build (read the new explanation aloud). All three trusted the number fully | Click a flame → read the popup | 🟡 Improved by [#105](https://github.com/RianaMalhotra/EmberWatch/pull/105); not yet met at the required rate |

## #8 Early-Warning Simulation

Story: [#8](https://github.com/RianaMalhotra/EmberWatch/issues/8)

| # | Criterion (short) | Issue(s) | Code / PR | Test or evidence | Demo step | Status |
|---|---|---|---|---|---|---|
| 8 | Early-warning alert simulation on historical wildfire events | [#8](https://github.com/RianaMalhotra/EmberWatch/issues/8), [#55](https://github.com/RianaMalhotra/EmberWatch/issues/55) | Not implemented. Related building blocks only: Investigation Lab **Playback** of historical satellite observations ([#109](https://github.com/RianaMalhotra/EmberWatch/pull/109)) and satellite detection history ([#113](https://github.com/RianaMalhotra/EmberWatch/pull/113)) | — | More → Investigation Lab → **Playback** | ⏸ **Deferred** ([#55](https://github.com/RianaMalhotra/EmberWatch/issues/55) is optional). `docs/requirements.md` has no acceptance criteria for this story |

## #9 Responsive Interactive Map Performance

Story: [#9](https://github.com/RianaMalhotra/EmberWatch/issues/9)

| # | Criterion (short) | Issue(s) | Code / PR | Test or evidence | Demo step | Status |
|---|---|---|---|---|---|---|
| 9.Q1 | Initial map load: 95% within 3 s (desktop) / 5 s (mobile), 30 scripted loads + Lighthouse on the deployed site | [#48](https://github.com/RianaMalhotra/EmberWatch/issues/48) | Production build; [`docs/map-performance.md`](map-performance.md); [#105](https://github.com/RianaMalhotra/EmberWatch/pull/105) | Edge local metrics: LCP 0.62 s (desktop, production preview, 1,000 detections) | — | 🟡 One local LCP sample is well under target, but **the 30-load Playwright/Lighthouse p95 on the deployed site has not been run** |
| 9.Q2 | Pan/zoom/layer toggle: 95% within 1 s (desktop) / 1.5 s (mobile); loading indicator within 0.5 s | [#48](https://github.com/RianaMalhotra/EmberWatch/issues/48) | Memoised `DetectionLayer`, stable cluster keys, cheaper CSS; [#105](https://github.com/RianaMalhotra/EmberWatch/pull/105) | `map-performance.md`: desktop INP 343 → **125 ms**; mobile emulation 1,118 → **555 ms**; `mapPerformance.test.jsx`; `App.test.jsx`: *shows a detection-specific loading state while the request is pending* | Explore with `?perf=1`; DevTools console shows `[map-perf]` timings | 🟡 Measured with INP and app timings, which are inside the targets; **not the 30-action Playwright p95 per action type** |
| 9.Q3 | Detail API: 95% of requests within 500 ms, < 1% errors, 20 concurrent users | [#9](https://github.com/RianaMalhotra/EmberWatch/issues/9) | — | — | — | ❌ **No load test (k6/Locust) has been run** |
| 9.B1 | Too many points → clustered, not dropped or freezing | [#48](https://github.com/RianaMalhotra/EmberWatch/issues/48) | `DetectionClusters.jsx` | `DetectionClusters.test.jsx`: *groups nearby observations at national zoom*, *preserves individual detections when zoomed in* | Zoom out to all of Canada | ✅ (tested up to 1,000 detections; the 10,000-point workload of assumption A2 has not been tested) |
| 9.B2 | Map interactions never wait for AI inference; *Processing…* state until ready | [#9](https://github.com/RianaMalhotra/EmberWatch/issues/9) | Risk scores arrive with `GET /api/risk-areas`; no per-interaction inference | Code review | — | 🟡 Interactions don't wait for inference, but there is **no *Processing…* state** (scores are computed per request, not asynchronously) |
| 9.B3 | A failed layer shows an error; the rest of the map stays interactive | [#25](https://github.com/RianaMalhotra/EmberWatch/issues/25) | As 4.1 | `App.test.jsx`: *keeps the risk map usable when the detections API fails* | Block `/api/detections` in DevTools | ✅ |
| 9.B4 | Phone: zoom, layer toggle and **Report a Fire** usable without horizontal scrolling | [#48](https://github.com/RianaMalhotra/EmberWatch/issues/48) | Responsive layout | [#115](https://github.com/RianaMalhotra/EmberWatch/pull/115) heuristic review (iPhone emulation, Nov 23–24) | DevTools → iPhone view → Explore | 🟡 Usable, but the review found **overlapping elements on phones** (nav over heading, legend over map, floating Ask Ash label); fixes are in open [#115](https://github.com/RianaMalhotra/EmberWatch/pull/115) |

## #10 Wildfire Detection and Confidence Scoring

Story: [#10](https://github.com/RianaMalhotra/EmberWatch/issues/10)

| # | Criterion (short) | Issue(s) | Code / PR | Test or evidence | Demo step | Status |
|---|---|---|---|---|---|---|
| 10.1 | Satellite/geospatial data (NASA FIRMS) classified as potential wildfire or not | [#17](https://github.com/RianaMalhotra/EmberWatch/issues/17), [#18](https://github.com/RianaMalhotra/EmberWatch/issues/18) | `backend/services/detection_pipeline.py` (`potential_wildfire` / `low_confidence`), loaders in `data-processing/`; [#67](https://github.com/RianaMalhotra/EmberWatch/pull/67), [#83](https://github.com/RianaMalhotra/EmberWatch/pull/83) | `test_detection_pipeline.py::test_confident_detection_is_potential_wildfire`, `::test_low_confidence_detection_is_kept_but_labelled` | Explore → bright vs faded flames | ✅ Classification is a **confidence-threshold rule**, not a trained image model |
| 10.2 | Each detection has a confidence score | [#18](https://github.com/RianaMalhotra/EmberWatch/issues/18) | Confidence from FIRMS stored per detection | `test_detection_pipeline.py::test_fetch_recent_detections_maps_columns_and_limits` | Click a flame → *Confidence* | ✅ The score is the FIRMS product's confidence, carried through unchanged |
| 10.3 | Location, timestamp and confidence shown with the classification | [#18](https://github.com/RianaMalhotra/EmberWatch/issues/18), [#48](https://github.com/RianaMalhotra/EmberWatch/issues/48) | `DetectionLayer.jsx` popup, details panel; [#105](https://github.com/RianaMalhotra/EmberWatch/pull/105) | `App.test.jsx`: *shows classified detections with location, timestamp, and confidence*; `DetectionLayer.labels.test.jsx` | Click a flame | ✅ |
| 10.4 | Below-threshold detections visually distinguished | [#19](https://github.com/RianaMalhotra/EmberWatch/issues/19) | Faded *Low-confidence hotspot* icon, legend entry | `DetectionLayer.labels.test.jsx`: *names single hotspots by confidence* | Legend → *Low-confidence hotspot* | ✅ |
| 10.5 | Threshold is configurable, not hard-coded | [#19](https://github.com/RianaMalhotra/EmberWatch/issues/19) | `MIN_DETECTION_CONFIDENCE` env var, default in `backend/config.py` | `test_detection_pipeline.py::test_threshold_comes_from_config_when_not_given`; `test_failure_handling.py::test_bad_confidence_threshold_is_a_config_error_not_a_quiet_fallback` | `MIN_DETECTION_CONFIDENCE=50 python app.py` | ✅ |
| 10.6 | Initial threshold chosen by backtesting and treated as provisional | [#19](https://github.com/RianaMalhotra/EmberWatch/issues/19), [#56](https://github.com/RianaMalhotra/EmberWatch/issues/56) | `ml/` scripts; [`docs/threshold-backtest.md`](threshold-backtest.md): threshold 20; held-out 2025 recall 0.889, precision 0.792; [#77](https://github.com/RianaMalhotra/EmberWatch/pull/77), [#111](https://github.com/RianaMalhotra/EmberWatch/pull/111) | `tests/test_backtest_threshold.py`; `tests/test_evaluate_threshold_split.py::test_threshold_is_chosen_on_training_years_only` | — | ✅ The held-out check found the threshold has little effect; the doc says so |
| 10.7 | Incomplete or unavailable input → no fabricated detection, gap reported | [#20](https://github.com/RianaMalhotra/EmberWatch/issues/20), [#46](https://github.com/RianaMalhotra/EmberWatch/issues/46) | `detection_validation.py`; `gaps` list in `GET /api/detections`; [#33](https://github.com/RianaMalhotra/EmberWatch/pull/33), [#89](https://github.com/RianaMalhotra/EmberWatch/pull/89) | `test_no_fabrication.py::test_unverifiable_detection_becomes_a_gap_never_a_marker`; `test_detection_pipeline.py::test_unusable_rows_are_reported_not_fabricated` | — | ✅ |

## #12 Maintainable and Modular Architecture

Story: [#12](https://github.com/RianaMalhotra/EmberWatch/issues/12)

| # | Criterion (short) | Issue(s) | Code / PR | Test or evidence | Demo step | Status |
|---|---|---|---|---|---|---|
| 12.1 | Components talk through documented APIs or module interfaces | [#29](https://github.com/RianaMalhotra/EmberWatch/issues/29), [#63](https://github.com/RianaMalhotra/EmberWatch/issues/63) | [`docs/component-interfaces.md`](component-interfaces.md), [`docs/sprint4-integration-contracts.md`](sprint4-integration-contracts.md); [#71](https://github.com/RianaMalhotra/EmberWatch/pull/71), [#97](https://github.com/RianaMalhotra/EmberWatch/pull/97), [#98](https://github.com/RianaMalhotra/EmberWatch/pull/98) | `test_sprint4_api_contracts.py`; `tests/test_firms_full_stack_contract.py`; `firmsContract.test.js` | — | ✅ |
| 12.2 | Changing one component touches at most two unrelated components | [#12](https://github.com/RianaMalhotra/EmberWatch/issues/12) | — | No integration file-count review recorded | — | 🟡 **Not formally measured.** Example: [#105](https://github.com/RianaMalhotra/EmberWatch/pull/105) (map performance) changed only frontend files and docs |
| 12.3 | Shared functionality in reusable modules | [#31](https://github.com/RianaMalhotra/EmberWatch/issues/31) | `frontend/src/services/requestHelpers.js`, `frontend/src/utils/*`, `backend/services/*`; [#88](https://github.com/RianaMalhotra/EmberWatch/pull/88) | `requestHelpers.test.js` | — | ✅ |
| 12.4 | Automated tests for critical functions (≥ 80%) | [#30](https://github.com/RianaMalhotra/EmberWatch/issues/30) | CI coverage gate `--cov-fail-under=80` on 7 critical backend modules (`.github/workflows/tests.yml`); [#72](https://github.com/RianaMalhotra/EmberWatch/pull/72), [#103](https://github.com/RianaMalhotra/EmberWatch/pull/103) | Measured **99%** on `6dcb585`; 499 + 257 + 240 tests passing | Run the commands above | ✅ |
| 12.5 | All public APIs and interfaces document inputs, outputs and purpose | [#29](https://github.com/RianaMalhotra/EmberWatch/issues/29), [#50](https://github.com/RianaMalhotra/EmberWatch/issues/50) | `component-interfaces.md`, `reports.md`, `detection-history-api.md`, `monitoring-and-security.md` | Documentation review (this file) | — | 🟡 Most routes documented; **`POST /api/ash-detective` has no API doc**. (`docs/testing-ci.md` was updated in this change to say the 80% gate is enforced.) |
| 12.6 | All existing tests pass before merging to `main` | [#30](https://github.com/RianaMalhotra/EmberWatch/issues/30) | CI on every pull request (Backend, Data-processing, Frontend tests, lint, build; dependency audit and staff-authorization checks in `security.yml`) | CI runs on each PR | — | 🟡 CI runs on every PR; **whether branch protection requires the checks cannot be verified from the repository** (needs a repository admin) |

## #13 Report a Fire and Fire Lifecycle History

Story: [#13](https://github.com/RianaMalhotra/EmberWatch/issues/13)

| # | Criterion (short) | Issue(s) | Code / PR | Test or evidence | Demo step | Status |
|---|---|---|---|---|---|---|
| 13.1 | **Report a Fire** button visible to every user, logged in or not | [#51](https://github.com/RianaMalhotra/EmberWatch/issues/51) | `frontend/src/App.jsx` (map header button), `ReportFire.jsx`; [#76](https://github.com/RianaMalhotra/EmberWatch/pull/76) | `App.test.jsx`: *shows both unavailable states, and Report a Fire still opens, when both feeds fail* | Explore → **Report a fire** (no login) | ✅ |
| 13.2 | Form collects location, time observed, flames/smoke/both, optional description ≤ 500 chars | [#51](https://github.com/RianaMalhotra/EmberWatch/issues/51) | `frontend/src/utils/reportForm.js` (`SIGHTINGS`, `MAX_DESCRIPTION = 500`); `backend/services/report_validation.py`; [#76](https://github.com/RianaMalhotra/EmberWatch/pull/76), [#101](https://github.com/RianaMalhotra/EmberWatch/pull/101) | `reportForm.test.js`: *lists every problem in plain words*, *builds the payload the backend stores*; `test_reports_52.py::test_invalid_field_is_rejected` | Open the form and step through each field | ✅ |
| 13.3 | Location by **Use my current location** or by choosing a point on the map | [#51](https://github.com/RianaMalhotra/EmberWatch/issues/51) | `ReportFire.jsx` (`locateMe`, map pin); [#76](https://github.com/RianaMalhotra/EmberWatch/pull/76) | `ReportFire.test.jsx`: *lets the user tap the map when location is denied* | Click **Use my current location**, then tap the map instead | ✅ |
| 13.4 | Current location uses the browser's permission prompt | [#51](https://github.com/RianaMalhotra/EmberWatch/issues/51) | `ReportFire.jsx` → `navigator.geolocation.getCurrentPosition` | Code review (browser API; prompt cannot be unit tested) | Click **Use my current location**; the browser asks for permission | ✅ |
| 13.5 | Denied / unavailable location, **or accuracy worse than 1 km**, falls back to choosing on the map | [#51](https://github.com/RianaMalhotra/EmberWatch/issues/51) | `ReportFire.jsx` error callback | `ReportFire.test.jsx`: *lets the user tap the map when location is denied* | Block location in the browser, then tap the map | 🟡 Denied/unavailable handled; **the 1 km accuracy check is not implemented** (`coords.accuracy` is never read) |
| 13.6 | Only the reported fire location is stored, not the user's ongoing location | [#51](https://github.com/RianaMalhotra/EmberWatch/issues/51), [#52](https://github.com/RianaMalhotra/EmberWatch/issues/52) | One-off `getCurrentPosition` (no `watchPosition`); `fire_reports` stores one point | Code review; `test_reports_52.py::test_valid_report_is_cleaned` | — | ✅ |
| 13.7 | Prominent warning: *This is not an emergency service. If there is immediate danger, call 911.* | [#51](https://github.com/RianaMalhotra/EmberWatch/issues/51) | `ReportFire.jsx` (`DISCLAIMER`) | `ReportFire.test.jsx`: *shows the emergency disclaimer and blocks Next until a location is set* | Open the form; the warning is at the top | ✅ |
| 13.8 | Confirmation after submission that the report was received and **not** sent to emergency services | [#51](https://github.com/RianaMalhotra/EmberWatch/issues/51) | `ReportFire.jsx` receipt screen | `ReportFire.test.jsx`: *reviews, submits once, and says the report is awaiting review* | Submit a report (local database only) and read the receipt | ✅ |
| 13.9 | Reports accepted regardless of past fire history or Low risk | [#52](https://github.com/RianaMalhotra/EmberWatch/issues/52) | `report_validation.py` has no history/risk condition | `test_reports_52.py::test_valid_report_returns_201_and_unverified` | Submit a report in an area with no fires | ✅ |
| 13.10 | Stored with `source = public report`, `status = Unverified`, submission time | [#52](https://github.com/RianaMalhotra/EmberWatch/issues/52) | `supabase/migrations/20261112000000_fire_reports.sql` (`source` default `public_report`, `review_status` default `unverified`, `created_at`); [#101](https://github.com/RianaMalhotra/EmberWatch/pull/101) | `test_reports_52.py::test_valid_report_returns_201_and_unverified`; `docs/reports.md` | — | ✅ |
| 13.11 | Report appears on the map **within 5 s**, labelled differently from satellite detections | [#53](https://github.com/RianaMalhotra/EmberWatch/issues/53) | `App.jsx` public-report markers: *Public report — Unverified*, *Community report, not a satellite detection*; [#104](https://github.com/RianaMalhotra/EmberWatch/pull/104) | `test_report_moderation_53.py::test_public_endpoint_redacts_unverified_and_rounds_all_coordinates` | Submit, then reload the map | 🟡 Label ✅; **the 5-second target has not been measured** |
| 13.12 | Descriptions shown as plain text (HTML/scripts escaped, links not clickable) | [#53](https://github.com/RianaMalhotra/EmberWatch/issues/53) | React text rendering (no `dangerouslySetInnerHTML`); unverified descriptions are hidden from the public entirely ([#104](https://github.com/RianaMalhotra/EmberWatch/pull/104)) | `test_report_moderation_53.py::test_public_endpoint_redacts_unverified_and_rounds_all_coordinates` | — | 🟡 Safe by construction, but **no test submits HTML/script/link text** as the verification asks |
| 13.13 | Rejected with a clear message if outside the supported region, in the future, or missing a field | [#51](https://github.com/RianaMalhotra/EmberWatch/issues/51), [#52](https://github.com/RianaMalhotra/EmberWatch/issues/52) | `report_validation.py` (future time with 5-min clock tolerance, required fields); `reportForm.js` | `test_reports_52.py::test_invalid_field_is_rejected`, `::test_small_clock_skew_is_allowed`; `reportForm.test.js`: *uses today's date for 'Earlier today' and rejects future times* | Pick a future time → error | 🟡 Future time and missing fields ✅; **no supported-region (Canada) check**: only latitude −90…90 / longitude −180…180 |
| 13.14 | Rate limits: 5/hour per device (browser token) and 30/hour per IP; excess not stored | [#52](https://github.com/RianaMalhotra/EmberWatch/issues/52) | `report_store.py` + `config.py`: **5 reports per 10 minutes per salted IP key** (configurable), trusted-proxy IP (`client_ip.py`); [#101](https://github.com/RianaMalhotra/EmberWatch/pull/101) | `test_reports_52.py::test_rate_limit_returns_429_with_retry_after`, `::test_rate_limit_is_per_sender`, `::test_concurrent_requests_cannot_exceed_the_limit`, `::test_forged_header_cannot_evade_limit_behind_render_proxy` | — | 🟡 Rate limiting works, but **differs from the criterion**: one per-IP limit, no per-device token, different numbers. Update the requirement or the code |
| 13.15 | Database unavailable → error message, no partial report stored | [#52](https://github.com/RianaMalhotra/EmberWatch/issues/52) | Single transaction in `report_store.save_report`; form keeps answers | `test_reports_52.py::test_outage_at_any_step_saves_nothing`, `::test_database_not_configured_returns_503`; `ReportFire.test.jsx`: *keeps the answers and shows an error if saving fails* | Stop the database, submit → error, answers kept | ✅ |
| 13.16 | Within 2 km and 24 h of a report or detection → linked, not a new fire | [#52](https://github.com/RianaMalhotra/EmberWatch/issues/52) | `report_store.py` (`DUPLICATE_RADIUS_M = 2000`, `DUPLICATE_WINDOW_HOURS = 24`, `linked_report_id`, `linked_detection_id`) | `test_reports_52.py::test_nearby_report_and_detection_are_linked_not_dropped`, `::test_duplicate_queries_use_2km_and_24h` | — | ✅ |
| 13.17 | Duplicate check runs server-side in the save transaction; simultaneous reports of one fire are linked | [#52](https://github.com/RianaMalhotra/EmberWatch/issues/52) | Same transaction; `pg_advisory_xact_lock` keyed by **sender** | `test_reports_52.py::test_concurrent_requests_cannot_exceed_the_limit` (same sender) | — | 🟡 In-transaction ✅; the lock is per sender, so **two simultaneous reports from different senders can both be saved unlinked** |
| 13.18 | Only logged-in staff can change status; the public cannot edit or delete | [#53](https://github.com/RianaMalhotra/EmberWatch/issues/53) | `backend/report_moderation.py` (Supabase Auth + staff allowlist), `StaffModeration.jsx`; [#104](https://github.com/RianaMalhotra/EmberWatch/pull/104), [#112](https://github.com/RianaMalhotra/EmberWatch/pull/112) | `test_staff_authorization_guard.py::test_public_cannot_modify_or_delete_reports`; `test_staff_moderation_sprint5.py::test_spoofed_role_headers_cannot_authorize` | — | ✅ (mocked auth; live staff session not verified) |
| 13.19 | Rejected → removed from the public map immediately, kept in the database with time and staff user | [#53](https://github.com/RianaMalhotra/EmberWatch/issues/53) | `GET /api/reports` excludes rejected/out; `fire_report_audit` (`supabase/migrations/20261114000000_report_moderation.sql`) | `test_report_moderation_53.py::test_public_reports_filter_excludes_rejected_and_out`, `::test_moderation_updates_and_writes_audit` | — | ✅ |
| 13.20 | Each status change is a new timestamped record; nothing overwritten | [#53](https://github.com/RianaMalhotra/EmberWatch/issues/53) | `fire_report_audit` rows per change; invalid transitions → 409 | `test_staff_moderation_sprint5.py::test_authenticated_staff_can_review_pending_report_with_audit`, `::test_disallowed_status_transition_is_conflict_and_not_audited` | — | ✅ |
| 13.21 | **Out** → no longer active, but kept with a full timeline in the historical view | [#53](https://github.com/RianaMalhotra/EmberWatch/issues/53), [#54](https://github.com/RianaMalhotra/EmberWatch/issues/54) | Out hidden from `GET /api/reports`; staff-only `GET /api/reports/{id}/audit` | `test_staff_moderation_sprint5.py::test_public_active_statuses_exclude_rejected_and_out`; `test_report_moderation_53.py::test_authorized_audit_returns_history` | — | 🟡 Hidden + audit ✅; **no public historical timeline view yet** ([#54](https://github.com/RianaMalhotra/EmberWatch/issues/54) in progress) |
| 13.22 | Historical fires from reports **and** satellite detections searchable by date range and area | [#46](https://github.com/RianaMalhotra/EmberWatch/issues/46), [#58](https://github.com/RianaMalhotra/EmberWatch/issues/58) | `DetectionHistoryExplorer.jsx`, `GET /api/detections/history`; [#84](https://github.com/RianaMalhotra/EmberWatch/pull/84), [#85](https://github.com/RianaMalhotra/EmberWatch/pull/85), [#113](https://github.com/RianaMalhotra/EmberWatch/pull/113) | `DetectionHistoryExplorer.test.jsx`; `test_detection_history.py` | More → Advanced analytics → **Satellite detection history** | 🟡 Satellite detections ✅; **public reports are not included** in the search |
| 13.23 | Only Confirmed reports feed historical fire activity for the heatmap | [#57](https://github.com/RianaMalhotra/EmberWatch/issues/57) | `risk_scoring.py` uses satellite detections only | `test_risk_validation_57.py::test_risk_areas_and_detections_use_separate_fields` | — | ❌ **Not implemented**: confirmed reports are not fed into the risk model |
| 13.24 | Unverified and Rejected reports excluded from risk-model data | [#57](https://github.com/RianaMalhotra/EmberWatch/issues/57) | No report data reaches the model | As 13.23 | — | ✅ (trivially: no reports are used at all) |
| 13.25 | Confirmed reports keep `source = public report` in the historical data | [#52](https://github.com/RianaMalhotra/EmberWatch/issues/52) | `fire_reports.source` column | `docs/reports.md` | — | 🟡 Tag stored ✅; not yet part of a historical dataset used by the model (see 13.23) |

## Cross-cutting evidence

| Area | Evidence | Where |
|---|---|---|
| **Usability** | Three-participant think-aloud study (6 tasks + task 7 for the new switch), findings and follow-ups | [`docs/map-performance.md` → Usability tasks](map-performance.md#usability-tasks-risk-vs-detection-confidence), [#105](https://github.com/RianaMalhotra/EmberWatch/pull/105) |
| | Nielsen-heuristics evaluation with keyboard, mobile and failure checks (one evaluator) | Review on [#115](https://github.com/RianaMalhotra/EmberWatch/pull/115) (Nov 24, 2026) |
| **Performance** | Bottleneck analysis, before/after INP and per-second rendering, mobile emulation, 1,000-detection run, limitations | [`docs/map-performance.md`](map-performance.md), [#105](https://github.com/RianaMalhotra/EmberWatch/pull/105) |
| **Security** | Trusted-proxy client IP, salted IP hashing (salt ≥ 32 chars required in production), rate limiting | `backend/services/client_ip.py`, `backend/config.py`, `test_reports_52.py`; [#101](https://github.com/RianaMalhotra/EmberWatch/pull/101) |
| | Staff-only moderation with Supabase Auth and an allowlist; spoofed role headers rejected; public cannot modify or delete | `backend/report_moderation.py`, `test_staff_moderation_sprint5.py`, `test_staff_authorization_guard.py`; [#104](https://github.com/RianaMalhotra/EmberWatch/pull/104), [#112](https://github.com/RianaMalhotra/EmberWatch/pull/112) |
| | Dependency audits (pip, `npm audit --omit=dev`) and an authorization regression job in CI | `.github/workflows/security.yml`; [`docs/monitoring-and-security.md`](monitoring-and-security.md) |
| **Data provenance** | Detection, environmental and risk-model provenance; threshold backtest and held-out evaluation | [`detection-data-provenance.md`](detection-data-provenance.md), [`environmental-data.md`](environmental-data.md), [`risk-model.md`](risk-model.md), [`threshold-backtest.md`](threshold-backtest.md) |

## Gaps and suggested owners

| Gap | Criteria | Suggested issue |
|---|---|---|
| Redeploy the Render backend from current `main` (still on `65a9f4c`), then verify reporting and moderation live (migrations already applied Nov 26) | 13.x (live), 9.B4 | [#61](https://github.com/RianaMalhotra/EmberWatch/issues/61) |
| Five-participant usability test with the defined risk/confidence/missing-data scenarios | 6.1, 6.3, 6.5 | [#60](https://github.com/RianaMalhotra/EmberWatch/issues/60) |
| Playwright load and interaction p95 on the deployed site; k6/Locust API load test; 10,000-point workload | 9.Q1, 9.Q2, 9.Q3, 9.B1 | [#60](https://github.com/RianaMalhotra/EmberWatch/issues/60) |
| Rank factors by contribution (weight × sub-score), show the top 3 and an area-specific summary | 3.4, 5.1, 5.3 | new issue |
| Supported-region check, 1 km accuracy fallback, per-device + per-IP rate limits as specified (or update the requirement), cross-sender duplicate linking, HTML/script test | 13.5, 13.12, 13.13, 13.14, 13.17 | [#59](https://github.com/RianaMalhotra/EmberWatch/issues/59) |
| Public historical timeline for reports; include reports in history search; feed confirmed reports to the risk model | 13.21, 13.22, 13.23, 13.25 | [#54](https://github.com/RianaMalhotra/EmberWatch/issues/54) |
| Document `POST /api/ash-detective`; confirm branch protection requires the CI checks | 12.5, 12.6 | [#62](https://github.com/RianaMalhotra/EmberWatch/issues/62) |
| Early-warning simulation | 8 | [#55](https://github.com/RianaMalhotra/EmberWatch/issues/55) (optional) |

## Keeping this file current

When a pull request changes behaviour covered here, update the matching row (status, PR link and test) in the same pull request, and re-run the three test commands above. Change a status to ✅ only when the evidence column names a test or a recorded result.
