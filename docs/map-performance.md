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

## Second bottleneck: rendering and painting (found in the browser)

After the marker fix, Edge's live metrics still showed slow interactions, so a Performance recording was taken on the **production build** (`npm run build && npm run preview`, Microsoft Edge, 4× CPU slowdown, 16.6 s of clicking areas and flames and typing in the search box):

| Category | Time | Share |
|---|---|---|
| Rendering (style and layout) | 4,583 ms | 28 % |
| Painting | 3,108 ms | 19 % |
| System | 2,041 ms | 12 % |
| **Scripting (React and Leaflet JavaScript)** | **1,745 ms** | **11 %** |

So after the marker fix, most of the remaining cost is **drawing**, not JavaScript. The timeline also kept painting while nothing was being clicked. The causes are decorative CSS effects in the dashboard theme:

1. **`backdrop-filter: blur(...)`** on the panels that sit over the map (side panel, map controls, map title). Anything that changes underneath, such as panning, a tile loading or an ember moving, forces the browser to recompute the blur. These panels are already 85–95 % opaque, so the blur is barely visible.
2. **The `ew-pulse` animation changes `box-shadow`**, which cannot be done by the GPU, so the page repaints on every frame forever.
3. **The rising embers** each drew a large blurred `box-shadow` while moving.

**Fix** (end of `frontend/src/prototype.css`): the blur is removed from the map overlays; the pulse animates only `opacity`; and the embers use a radial-gradient glow instead of a box-shadow. Now only `opacity` and `transform` animate, which the GPU handles without repainting the page. The look stays the same, and `prefers-reduced-motion` still turns the animations off.

**Result** (same setup: production build, Edge, 4× CPU, a similar session of clicking areas and flames and typing in search). The two recordings had different lengths (16.6 s vs 10.3 s), so the times are compared per second of recording:

| | Before the CSS fix | After | Change |
|---|---|---|---|
| **INP** (worst interaction) | 343 ms (needs improvement) | **125 ms (good)** | −64 % |
| Rendering per second | 277 ms | 74 ms | −73 % |
| Painting per second | 188 ms | 31 ms | −83 % |
| Scripting per second | 105 ms | 65 ms | −38 % |

The slowest interaction after the fix broke down as 1 ms input delay, 56 ms processing (JavaScript) and 68 ms presentation delay (drawing). Its 125 ms is under Google's 200 ms "good" INP threshold, and close to the 100 ms "feels instant" target. The sessions were done by hand, so they are similar but not identical; the size of the drop is clear, but the exact percentages are approximate.

### Development server vs production build

Measured on the development server first (`npm run dev`, Edge, 4× CPU, after the marker fix), Edge's live metrics showed LCP 1.39 s (good), CLS 0.04 (good) and INP **3,504 ms** (poor). Typing in the search box took 1.1–2.2 s per key, and clicking a risk circle took 0.8–2.1 s. React's development mode adds extra checks and double renders, so these numbers are exaggerated. On the production build the same kind of session gave INP **343 ms**. All further results use the production build.

## Third bottleneck: markers re-added on zoom (found on mobile)

Mobile was measured with the production build in Microsoft Edge, iPhone 16 device emulation, 4× CPU slowdown, in a 1.6-minute session of tapping risk areas and flames, zooming and searching. The session also included a page load ("Loading" 2.3 s).

| | Desktop (after CSS fix) | **Mobile emulation** |
|---|---|---|
| INP | 125 ms (good) | **1,118 ms (poor)** |
| Scripting per second | 65 ms | 261 ms |
| Rendering per second | 74 ms | 184 ms |
| Painting per second | 31 ms | 31 ms |

The slowest interaction (1,118 ms) broke down as **3 ms** input delay, **833 ms processing** and **282 ms** presentation delay. So on mobile the cost was **JavaScript**, not drawing; painting stayed as low as on desktop, so the CSS fix holds there too. In that interaction's time range, map tiles started downloading right after the tap, so the tap moved or zoomed the map; tapping a risk area flies the map in to zoom 10. In the Bottom-up view, Leaflet's **`addLayer`** was the largest application cost (3.8 s total), which means markers were being added to the map over and over.

**Cause:** below zoom 7 detections are grouped by grid cell, and every group, even one holding a single detection, got the grid-cell key. At zoom 7 and above each detection gets its id as the key. So whenever the zoom crossed into or between clustered levels, every marker's React key changed, React removed every marker, and Leaflet built them all again, including the hundreds of lone detections that had not moved.

**Fix** (`frontend/src/components/DetectionClusters.jsx`): a lone detection now keeps its id as its key at every zoom level, and only real groups get a `cluster-…` key, which can never collide with an id. Measured with `mapPerformance.test.jsx` (deterministic, counts markers added when zooming from 6 to 10):

| Detections | Markers re-added, zoom 6 → 10, before | After |
|---|---|---|
| 200 | 200 | **32** (only those that were in clusters) |
| 1000 | 1000 | **596** |

The remaining additions are unavoidable: those markers really do appear when a cluster splits.

**Mobile result after the key fix** (same setup; a 1.1-minute session, also hand-driven, so similar but not identical):

| Slowest interaction (INP) | Before key fix | After |
|---|---|---|
| **Total** | **1,118 ms** | **555 ms** (−50 %) |
| Input delay | 3 ms | 8 ms |
| Processing (JavaScript) | 833 ms | 451 ms (−46 %) |
| Presentation delay (drawing) | 282 ms | 96 ms (−66 %) |

**Remaining work.** On the emulated phone, INP is now 555 ms, just above Google's 500 ms "poor" line and well above the 200 ms "good" target. Desktop meets it at 125 ms. Per second, rendering in this session (258 ms) was higher than in the first mobile session (184 ms), so style and layout work on the small screen is now the larger cost. Likely next steps, not done in #48:
- Avoid the zoom-10 fly-in when an area is tapped on small screens, so fewer clusters split at once.
- Profile the details panel layout and the smooth `scrollIntoView` on phones.
- Measure on a physical phone: emulation with 4× slowdown is a rough stand-in.

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

1. Run the backend (`cd backend && python app.py`) and the **production build** of the frontend (`cd frontend && npm run build && npm run preview`, port 4173) with the Supabase database. Don't measure `npm run dev`: React's development mode is several times slower.
2. Open Chrome or Edge → DevTools → **Performance** panel → CPU: **4× slowdown** (simulates a mid-range phone). Leave network unthrottled, so the numbers measure the map rather than the connection.
3. **Desktop:** window about 1366 × 768. Open `http://localhost:4173/?perf=1`, go to **Explore map**, and wait for the flames. Click 5 different risk circles and 5 flame markers (zoom in first), and type a place name in the search box. Reload and repeat 3 times.
4. **Mobile:** DevTools device toolbar → **iPhone 12 Pro**. Same steps, tapping instead of clicking.
5. Repeat steps 3–4 with `?perf=1&detections=1000`.
6. In the console, run `copy(JSON.stringify(window.__mapPerf))`, then put the medians in the table below.
7. Optional, to see the before/after directly: record a Performance trace while typing in the search box on `main` before this change and after it, and compare the "Scripting" time.

Results (Microsoft Edge, production build, 4× CPU, 200 detections; per-second values normalise for different recording lengths):

| Setup | INP | Rendering / s | Painting / s | Scripting / s | Notes |
|---|---|---|---|---|---|
| Desktop, development server, after marker fix | 3,504 ms | – | – | – | Typing 1.1–2.2 s per key; not representative (dev mode) |
| Desktop, production, after marker fix | 343 ms | 277 ms | 188 ms | 105 ms | Mostly drawing cost (blur, box-shadow animations) |
| **Desktop, production, after marker + CSS fix** | **125 ms** | **74 ms** | **31 ms** | **65 ms** | Good (under 200 ms) |
| Mobile emulation (iPhone 16), production, after marker + CSS fix | 1,118 ms | 184 ms | 31 ms | 261 ms | Poor. 833 ms of JavaScript in the slowest tap; markers re-added on zoom (see third bottleneck). Session included a page load |
| **Mobile emulation (iPhone 16), production, after key fix** | **555 ms** | 258 ms | 39 ms | 210 ms | Halved, but still above 500 ms (poor) on a 4× slowed phone; see remaining work |
| Desktop, production, **1000 detections** | 104 ms | 289 ms | 53 ms | 341 ms | Good INP, but Edge counted only 4 interactions, so it is a small sample. The app's own timings (click until the panel has updated, two frames later) were higher: area select median 221 ms (156–547 ms, n = 6), flame select median 274 ms (165–1,623 ms, n = 6; the 1,623 ms was the first flame click). Main thread busy about 63 % of the 230 s recording (scripting + rendering), with long tasks throughout. Browser extensions were running (about 3.6 s in total). Measured Nov 26, 2026 |

**Reading the 1,000-detection row.** INP only measures until the browser shows its *first* frame after a click; the app's `[map-perf]` timings wait until the details panel has finished updating, so they are closer to what the user waits for. With 1,000 flames, desktop still stays under 300 ms for a typical click, but scripting and rendering per second are 4–5× higher than with 200 detections, and the main thread is rarely idle. 1,000 detections is therefore usable on desktop but not light; the follow-up in *Remaining work* (canvas markers or server-side clustering) applies here too. The 1,000-detection mobile run was not measured.

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
| 7 | "Show only fires from the last 24 hours." (added for P3, to test the new switch) | Finds **Fire detections → Last 24 h** without help | Desktop |

### Results

P1 and P2 were run on Nov 23, 2026, on the developer's laptop (current `main`, Microsoft Edge); phone tasks used Edge's device emulation. P3 was run on Nov 26, 2026. None of them had seen EmberWatch before.

- **P1**: Arts & Science student
- **P2**: Mechanical Engineering student
- **P3**: first-year Arts & Science student (life sciences). Given one minute to browse freely first, then the tasks.

**Note on P3's build.** P3's main session was accidentally run on the build from PR #115 (the usability-improvements branch), not this branch, so it did not include this PR's popup text or age switch. Tasks 3 and 7 were therefore repeated with P3 on this branch's build (commit `02cfeb8`) the same day. Both results are reported below and kept separate.

| Task | P1 | P2 | P3 | Notes |
|---|---|---|---|---|
| 1. Highest-risk area | ✅ | ✅ | ✅ | Found the orange (moderate) areas and reasoned "there's no red, so these must be the highest". Correct, but they had to work it out; the map never says which area is highest |
| 2. Read a detection's confidence | ✅ | ✅ | ✅ | Both found a flame and read its confidence |
| 3. Does high confidence mean high area risk? | ⚠️ / ❌ | ⚠️ / ❌ | #115 build: ⚠️ · **this PR: ✅** | **P1 and P2 did not clearly separate confidence from risk.** One said: "what is this confidence score even about? I feel like I understand nothing." The other treated confidence as "how accurate the detection is" (correct), but judged it by how many flames were nearby: a flame in a dense cluster above 50 % is "accurate", a lone flame "has a chance but isn't fully accurate". (Which answer came from which participant was not recorded.) **P3, #115 build:** trusted the confidence value fully ("I will trust that it's correct"), without separating it from area risk. **P3, this PR's build:** opened a flame and answered by reading the new popup explanation aloud. The text is found and answers the question at the moment it is needed; reading it aloud does not show she would remember the difference without the popup. |
| 4. Incomplete area and its missing inputs | ✅ | ✅ | ✅ | Both found them, but asked why so much information is missing |
| 5. Phone: tap an area, read its risk score | ⚠️ | ⚠️ | ✅ | Found it, but the text was too small; they had to lean in to read |
| 6. Phone: search for Kelowna | ✅ | ✅ | ✅ | Found it; text again too small. P3 found it but saw no information for the area and thought the site might still be loading or lagging |
| 7. Show only the last 24 hours | – | – | ✅ (this PR) | Found **Fire detections → Last 24 h** on her own |

### Findings

1. **Detection confidence vs area risk is still not understood (task 3).** This is the key question for #48. Labels alone ("Confidence:", "risk score") did not explain the difference to first-time users.
2. **Current and historical detections look identical.** P2 could not tell which flames are current fires and which are old records, which is important for a wildfire app. Both participants suggested **a button to switch between today's fires and historical ones**.
3. **Scope is unclear: the app covers Canada only.** The home page says it monitors 13 areas, but in small text that P2 said he "had no time to read". He panned to other countries and found no data.
4. **"Information not available" appears often.** Missing values are repeated field by field, and P2 read this as the app being unfinished ("looks pretty but…").
5. **Text is too small and too dense, with too many numbers**, on both desktop and phone (all three participants mentioned small text). P1 was also unsure what to do first on the home page.
6. **The browser Back button left the website** instead of returning to the previous page. **Fixed in #48** (below).
7. Ask Ash could not answer "who made this website?". (Project-overview answers were added to Ask Ash on Nov 22; this may need re-checking on the deployed version.)
8. **All three participants trusted the confidence number fully.** P3 said "I will trust that it's correct". Confidence is the satellite's own estimate, not a verified result; the popup now says what it measures, but not that it can be wrong.
9. **Empty states look like loading (P3).** When a place had no information, she read the blank area as the site still loading or lagging. Suggested: one line saying *why* nothing is shown (e.g. "No satellite detections near Kelowna in the loaded records").
10. **Choosing a monitored area zooms to its centre, not to its fires (P3).** She expected to be taken to where fires are happening in that area.
11. **Feature request (P3):** when an area is selected, list its fires from the last week by date in the side panel.
12. **Vegetation data (P3):** every area is "incomplete: missing Vegetation Index"; she suggested adding it.
13. Positive: P3 said it "looks amazing", understood overall what it does, completed the tasks quickly, and asked whether it is for the general public (it is).

### Improvements

| Finding | Action |
|---|---|
| 6. Back leaves the site | **Fixed in this PR:** each page is a browser history entry (`#home`, `#explore`, …), so Back/Forward move between EmberWatch pages and links like `/#explore` open that page directly. Query parameters such as `?perf=1` are kept. Tests: `frontend/src/navigationHistory.test.jsx` |
| 1. Confidence vs risk | **Partly addressed in this PR:** every flame popup now explains the value: "Confidence is how sure the satellite is that this spot is a heat source. It is not the area's wildfire risk (the coloured circles show that)." Test: `frontend/src/components/DetectionLayer.labels.test.jsx`. Re-tested with P3: she answered task 3 by reading this text aloud (see Results). **Follow-up, tracked separately:** the same explanation in the details panel and a short "Risk vs detection" note in the legend. Both live in `App.jsx` sections that #115 is also changing (it adds "not a confirmed wildfire or an environmental risk score" to the details panel), so they are left until #115 merges, to avoid conflicting rewrites |
| 2. Current vs historical | **Fixed in this PR, as participants suggested:** a **Fire detections** switch in the map controls (**All / Last 24 h / Historical**) filters the flames by age; with no detections in the last 24 hours it says so. Detections without a valid time are never shown as current. Tests: `frontend/src/utils/detectionAge.test.js`, `frontend/src/detectionAge.app.test.jsx`. Still recommended: a visual difference (e.g. faded older flames) for the "All" view |
| 8. Overtrust in confidence | Follow-up: add "an estimate, not a confirmed fire" to the popup or legend |
| 9. Empty states look like loading | Follow-up: one-line explanation when a place has no data |
| 10–11. Area zoom and weekly fire list | Follow-up feature: zoom to the area's detections and list them by date in the side panel |
| 12. Vegetation index missing | Follow-up (data): no vegetation source is loaded for any area |
| 3. Canada-only scope | Recommended: a prominent line on the home page and map ("Monitoring 13 areas across Canada"), and limit map panning to Canada |
| 4. Missing data | Recommended: explain missing inputs once per area (what is missing, why, and that the score is re-weighted) instead of repeating "not available" per field |
| 5. Readability | Recommended: larger base font for descriptions on desktop and phone, a short plain-language summary before detailed numbers, and numbers behind "Show details" |

Items 3, 4 and 5 (and the rest of item 1) change the dashboard design, so they are recorded as follow-up work rather than redesigned inside #48.

## Limitations

- The automated measurement counts React and Leaflet work, not pixels. Drawing time is only covered by the browser measurement.
- Mobile was measured with Chrome's device emulation and CPU throttling, not on physical phones (unless noted in the results).
- Flame markers are still one HTML element each. When zoomed in with 1000 detections, that is 1000 DOM elements, which panning has to move. A canvas-drawn marker would be lighter but would lose the emoji flame design.
- At zoom 6 the clustering grid (0.55°) still left 651 separate markers for 1000 detections, so it reduces the count much less than at zoom 3–5.
- **Mobile INP is still 555 ms** (iPhone 16 emulation, 4× CPU slowdown), above the 500 ms "poor" line, even after halving it from 1,118 ms. Desktop is good (125 ms). This is tracked as follow-up optimization; the likely next step is fewer DOM markers (canvas markers or server-side clustering) and lighter panel updates on tap.
- Detections are limited to the 200 newest by default. Showing many thousands would need server-side clustering or tiling.
- Usability: 3 participants, all friends of the developer, tested on one laptop; P3's main session used the #115 build, and only tasks 3 and 7 were repeated on this branch. That is enough to reveal obvious problems, which it did, but not to measure how common they are.
