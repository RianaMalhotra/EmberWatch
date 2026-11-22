# Issue 48 — usability and map performance

## Evidence recorded
The PR workflow checks for commit fef71a15d2859cc4ae7d3f00979ee57e380ccef8 all succeeded: EmberWatch Tests, dependency security, PostGIS integration and FIRMS full-stack integration. Subsequent commits require a fresh run. Automated tests use mocked map components and do not measure real Leaflet rendering or human task completion.

## Manual verification matrix
Use the PR preview and main under identical conditions. Record commit, browser, device, viewport, network, area and detection counts. Use desktop 1440×900 and mobile 390×844. Record five cold and five warm runs with DevTools Performance, reporting median and range for navigation to map readiness, selection to details paint, zoom and layer switch to settled map. Separate tile/network delays from scripting. Do not infer real performance from jsdom tests.

| Task | Expected | Actual |
|---|---|---|
| Find monitored area | Risk and factors visible | Pending |
| Find unmonitored place | No invented risk | Pending |
| Explain flame vs risk circle | Observation confidence distinct from modeled risk | Pending |
| Failed search | Retry and retained query | Pending |
| Keyboard-only guide and map | Visible focus and usable controls | Pending |
| Mobile map and chatbot | No clipped controls or obscured details | Pending |
| Staff and non-staff test accounts | Correct permissions and privacy | Pending |

Use authorized staging accounts only; do not send production test reports. Record completion, time, errors and assistance for first-time users. Check contrast using browser accessibility tools. No human or live-browser measurements have been collected by this PR authoring session.
