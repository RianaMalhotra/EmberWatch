// #48: reproducible map interaction measurement.
//
// Leaflet itself can't be timed in jsdom, so this test measures what makes the
// map slow in React: wasted work on the satellite fire markers. For every
// <Marker> it counts
//   - renders: React re-rendering the marker, and
//   - icon swaps: the marker receiving a different `icon` object. react-leaflet
//     then calls Leaflet's setIcon(), which throws away the marker's HTML
//     element and builds a new one, the most expensive thing a marker can do.
// It renders the dashboard with representative data (12 areas, 200 and 1000
// detections: the app default and the API maximum), at the default zoom
// (clustered) and zoomed in (every hotspot drawn), then types in the search box
// and selects an area. Browser timings are measured separately with ?perf=1
// (see docs/map-performance.md).
//
// Run: npx vitest run src/test/mapPerformance.test.jsx --silent=false
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { fetchRiskAreas } from "../services/riskApi";
import { fetchDetections } from "../services/detectionApi";
import { makeAreas, makeDetections } from "./mapFixtures";

const stats = vi.hoisted(() => ({ renders: 0, iconSwaps: 0, mounts: 0, lastIcon: new Map() }));
const zoom = vi.hoisted(() => ({ level: 6, handlers: [] }));
const mockMap = vi.hoisted(() => ({
  fitBounds() {}, panTo() {}, flyTo() {}, setView() {}, invalidateSize() {},
  getBounds: () => ({ contains: () => true }),
  getZoom: () => zoom.level,
  on(event, handler) { if (event === "zoomend") zoom.handlers.push(handler); },
  off(event, handler) { zoom.handlers = zoom.handlers.filter((h) => h !== handler); },
}));

vi.mock("react-leaflet", async () => {
  const React = await import("react");
  const el = React.createElement;
  return {
    MapContainer: ({ children }) => el("div", { "data-testid": "map" }, children),
    TileLayer: () => null,
    Popup: () => null, // Leaflet only renders popup content when a popup opens
    Tooltip: ({ children }) => el("span", null, children),
    Circle: () => null,
    useMap: () => mockMap,
    useMapEvents: () => mockMap,
    CircleMarker: ({ center, eventHandlers }) =>
      el("button", { type: "button", "aria-label": `Select area at ${center.join(", ")}`, onClick: eventHandlers?.click }),
    Marker: ({ position, icon }) => {
      // A mount is Leaflet's addLayer(): building the marker's HTML element.
      React.useEffect(() => { stats.mounts += 1; }, []);
      const key = position.join(",");
      stats.renders += 1;
      if (stats.lastIcon.has(key) && stats.lastIcon.get(key) !== icon) stats.iconSwaps += 1;
      stats.lastIcon.set(key, icon);
      return el("span", { "data-testid": "fire-marker" });
    },
  };
});

vi.mock("../services/riskApi", () => ({ fetchRiskAreas: vi.fn() }));
vi.mock("../services/detectionApi", () => ({ fetchDetections: vi.fn() }));

beforeEach(() => {
  // Place search (Open-Meteo geocoding) returns nothing in this test.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  zoom.level = 6;
  zoom.handlers = [];
  stats.lastIcon.clear();
});

function resetStats() {
  stats.renders = 0;
  stats.iconSwaps = 0;
  stats.mounts = 0;
}

async function renderDashboard(detectionCount, zoomLevel) {
  const detections = makeDetections(detectionCount);
  fetchRiskAreas.mockResolvedValue({ source: "supabase", data: makeAreas(12) });
  fetchDetections.mockResolvedValue({ detections, threshold: 20, counts: { shown: detections.length } });

  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Explore map" }));
  await screen.findAllByRole("button", { name: /Select area at/ });
  await waitFor(() => expect(screen.getAllByTestId("fire-marker").length).toBeGreaterThan(0));

  if (zoomLevel !== 6) {
    zoom.level = zoomLevel;
    act(() => zoom.handlers.forEach((handler) => handler()));
  }
  const markers = screen.getAllByTestId("fire-marker").length;
  resetStats();
  return markers;
}

describe.each([
  [200, 6], [200, 8], [1000, 6], [1000, 8],
])("%i detections at zoom %i", (count, zoomLevel) => {
  it("typing in the search box and selecting an area do not rebuild fire markers", async () => {
    const user = userEvent.setup();
    const markers = await renderDashboard(count, zoomLevel);

    let start = performance.now();
    await user.type(screen.getByPlaceholderText("Search anywhere in Canada..."), "Area");
    const typeMs = performance.now() - start;
    const typing = { renders: stats.renders, iconSwaps: stats.iconSwaps };
    resetStats();

    await user.clear(screen.getByPlaceholderText("Search anywhere in Canada..."));
    resetStats();
    start = performance.now();
    await user.click(screen.getAllByRole("button", { name: /Select area at/ })[0]);
    const clickMs = performance.now() - start;
    const click = { renders: stats.renders, iconSwaps: stats.iconSwaps };

    console.info(
      `[#48] ${count} detections, zoom ${zoomLevel}: ${markers} fire markers drawn | ` +
      `typing 4 letters: ${typing.renders} marker renders, ${typing.iconSwaps} icon swaps, ${typeMs.toFixed(0)} ms | ` +
      `area click: ${click.renders} marker renders, ${click.iconSwaps} icon swaps, ${clickMs.toFixed(0)} ms`,
    );

    expect(typing.iconSwaps).toBe(0);
    expect(typing.renders).toBe(0);
    expect(click.iconSwaps).toBe(0);
    expect(click.renders).toBe(0);
  }, 60_000);
});

// A phone recording (Edge, iPhone 16 emulation, 4x CPU) showed Leaflet's
// addLayer as the biggest app cost: zooming in after tapping an area gave
// every lone detection a new React key, so all markers were removed and added
// again. Lone detections now keep their key at every zoom level.
describe.each([200, 1000])("zooming in with %i detections", (count) => {
  it("only re-adds markers that were part of a cluster", async () => {
    await renderDashboard(count, 6);
    const lone = (await import("../components/DetectionClusters"))
      .clusterDetections(makeDetections(count), 6)
      .filter((cluster) => cluster.items.length === 1).length;
    const total = count;

    zoom.level = 10;
    act(() => zoom.handlers.forEach((handler) => handler()));

    console.info(`[#48] zoom 6 -> 10 with ${count} detections: ${stats.mounts} markers added (was ${total} before the key fix; ${lone} lone markers kept)`);
    expect(stats.mounts).toBe(total - lone);
  }, 60_000);
});
