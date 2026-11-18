# Map performance and usability (#48)

Goal: measure how the Explore map behaves with representative data on desktop and mobile, fix the main bottlenecks, and check that users can tell **wildfire risk** (risk circles) apart from **detection confidence** (flame markers).

## Representative data

| Data | Amount | Why |
|---|---|---|
| Monitored areas | 12 | Roughly the number in `data-processing/areas.csv` |
| Detections | 200 | What the app loads by default (`fetchDetections(200)`) |
| Detections | 1000 | The most `/api/detections` allows (`limit` 1–1000), as a worst case |
| Zoom 6 | | The default Explore view. Nearby detections are grouped into cluster markers |
| Zoom 8 | | Zoomed in. Every hotspot is its own flame marker (clustering stops at zoom 7) |

Automated tests use seeded synthetic data with the same shape as the API (`frontend/src/test/mapFixtures.js`), so every run uses identical data. Browser checks use the real API.

## Bottleneck found

**Every App render rebuilt every flame marker's HTML.** Satellite detections are Leaflet `Marker`s with a `divIcon` (an HTML element, not a canvas shape). On every render of `App`, the code:

1. re-ran `clusterDetections` over all detections, and
2. created a **new** `divIcon` object for every marker.

react-leaflet compares the `icon` prop by reference, so each new object made it call Leaflet's `setIcon()`. That removes the marker's HTML element from the page and builds a new one. `App` re-renders on every letter typed in the search box, every area click and every panel toggle, so the whole marker layer was rebuilt each time even though nothing about the detections had changed.

## Fix

| Change | Where |
|---|---|
| Flame markers moved into a memoised `DetectionLayer` component; it only re-renders when the detections, the zoom level or the threshold change | `frontend/src/components/DetectionLayer.jsx` |
| Icons created once and reused: one for "likely", one for "low confidence", one per cluster size | `DetectionLayer.jsx` |
| Clusters recomputed only when the detections or zoom change (`useMemo`) | `DetectionLayer.jsx` |
| Marker click handlers made stable (`useCallback`), so they don't defeat the memo | `selectDetection`, `zoomToCluster` in `App.jsx` |

Behaviour is unchanged: the same markers, clusters, popups, cluster zoom and detection details as before, with all existing tests passing.

## Measurement A: automated, reproducible (wasted marker work)

```
cd frontend
npx vitest run src/test/mapPerformance.test.jsx --silent=false
```

The test renders the dashboard with the data above, types four letters in the search box, then clicks a risk area. For every flame `Marker` it counts:

- **renders**: React re-rendering the marker
- **icon swaps**: the marker getting a different `icon` object, which makes Leaflet rebuild its HTML element

These counts are deterministic: they are the same on every machine. The test fails if typing or selecting an area rebuilds any marker, so the fix is protected from regressions.

Results (3 runs each; counts identical in every run, times are medians):

| Detections, zoom | Markers on map | Typing 4 letters: renders / icon swaps, before → after | Typing time, before → after | Area click: renders / icon swaps, before → after | Area click time, before → after |
|---|---|---|---|---|---|
| 200, zoom 6 | 183 | 915 / 915 → **0 / 0** | 195 → 60 ms | 183 / 183 → **0 / 0** | 72 → 62 ms |
| 200, zoom 8 | 200 | 1000 / 1000 → **0 / 0** | 160 → 72 ms | 200 / 200 → **0 / 0** | 46 → 36 ms |
| 1000, zoom 6 | 651 | 3255 / 3255 → **0 / 0** | 553 → 30 ms | 651 / 651 → **0 / 0** | 78 → 58 ms |
| 1000, zoom 8 | 1000 | 5000 / 5000 → **0 / 0** | 818 → 67 ms | 1000 / 1000 → **0 / 0** | 401 → 50 ms |

The times come from jsdom with a mocked map (Node 22), so they show the relative change, not what a user feels. In a real browser each icon swap also deletes and re-creates a DOM element and re-lays it out, so the real saving should be larger. That is what measurement B checks.

## Measurement B: real browser (load and interaction time)

Timing is built into the app and switched on by the URL, so anyone can repeat it:

- `?perf=1` logs timings to the browser console and keeps them in `window.__mapPerf`
  - `detections-load`: from starting the request to the markers drawn on screen
  - `area-select`: from clicking or tapping a risk circle to the details panel drawn
  - `detection-select`: from clicking a flame marker to the details panel drawn
- `?detections=1000` loads 1000 detections instead of 200

Each timing stops two animation frames after React updates, so it includes the browser drawing the change.

Protocol:

1. Run the backend (`cd backend && python app.py`) and frontend (`cd frontend && npm run dev`) with the Supabase database.
2. Open Chrome → DevTools → **Performance** panel → CPU: **4× slowdown** (simulates a mid-range phone). Leave network unthrottled, so the numbers measure the map rather than the connection.
3. **Desktop:** window about 1366 × 768. Open `http://localhost:5173/?perf=1`, go to **Explore map**, and wait for the flames. Click 5 different risk circles and 5 flame markers (zoom in first), and type a place name in the search box. Reload and repeat 3 times.
4. **Mobile:** DevTools device toolbar → **iPhone 12 Pro**. Same steps, tapping instead of clicking.
5. Repeat steps 3–4 with `?perf=1&detections=1000`.
6. In the console, run `copy(JSON.stringify(window.__mapPerf))`, then put the medians in the table below.
7. Optional, to see the before/after directly: record a Performance trace while typing in the search box on `main` before this change and after it, and compare the "Scripting" time.

Results:

| Setup | Detections | `detections-load` | `area-select` | `detection-select` | Typing in search smooth? |
|---|---|---|---|---|---|
| Desktop, 4× CPU | 200 | | | | |
| Desktop, 4× CPU | 1000 | | | | |
| Mobile emulation, 4× CPU | 200 | | | | |
| Mobile emulation, 4× CPU | 1000 | | | | |

Target: interactions under 100 ms feel instant (RAIL guideline); markers drawn within about 1 s of the data arriving.

## Usability tasks: risk vs detection confidence

Run with at least 3 people who did not build the app, on desktop and on a phone. Don't explain the map first. Record whether each task was completed without help, roughly how long it took, and anything the person said or misread.

| # | Task (read aloud) | Success means | Device |
|---|---|---|---|
| 1 | "Which monitored area has the highest wildfire risk right now?" | Names the right area using the circles' colours or the monitored-areas list | Desktop |
| 2 | "Find one satellite fire detection. How confident is the satellite that it's a fire?" | Zooms in or opens a cluster, opens a flame, reads the confidence | Desktop |
| 3 | "This flame shows 90 % confidence. Does that mean the area around it has HIGH wildfire risk?" | Says no: confidence is about the satellite hotspot, risk is about the area's conditions | Desktop |
| 4 | "Pick an area whose risk assessment is incomplete. What information is missing?" | Finds a dashed circle and reads the missing inputs | Desktop |
| 5 | "On this phone, tap an area and tell me its risk score." | Finds the score in the details panel without being told to scroll | Phone |
| 6 | "Search for Kelowna. Is a risk score available there?" | Finds the place and understands whether it is a monitored area | Phone |

Results:

| Task | P1 | P2 | P3 | Notes |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |

## Limitations

- The automated measurement counts React and Leaflet work, not pixels. Drawing time is only covered by the browser measurement.
- Mobile was measured with Chrome's device emulation and CPU throttling, not on physical phones (unless noted in the results).
- Flame markers are still one HTML element each. When zoomed in with 1000 detections, that is 1000 DOM elements, which panning has to move. A canvas-drawn marker would be lighter but would lose the emoji flame design.
- At zoom 6 the clustering grid (0.55°) still left 651 separate markers for 1000 detections, so it reduces the count much less than at zoom 3–5.
- Detections are limited to the 200 newest by default. Showing many thousands would need server-side clustering or tiling.
- With fewer than 5 participants, the usability results show obvious problems but are not statistically meaningful.
