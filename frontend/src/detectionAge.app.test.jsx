// #48 usability: a switch between fires from the last 24 h and older records.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { fetchDetections } from "./services/detectionApi";

vi.mock("react-leaflet", async () => {
  const React = await import("react");
  const el = React.createElement;
  const map = { fitBounds() {}, flyTo() {}, setView() {}, invalidateSize() {}, getZoom: () => 8, on() {}, off() {}, getBounds: () => ({ contains: () => true }) };
  return {
    MapContainer: ({ children }) => el("div", null, children),
    TileLayer: () => null, Popup: () => null, Tooltip: () => null, Circle: () => null, CircleMarker: () => null,
    Marker: ({ position }) => el("span", { "data-testid": "fire-marker", "data-position": position.join(",") }),
    useMap: () => map, useMapEvents: () => map,
  };
});
vi.mock("./services/riskApi", () => ({ fetchRiskAreas: vi.fn().mockResolvedValue({ source: "supabase", data: [] }) }));
vi.mock("./services/detectionApi", () => ({
  fetchDetections: vi.fn(),
  fetchDetectionHistory: vi.fn().mockResolvedValue({ detections: [] }),
  fetchFireHistory: vi.fn().mockResolvedValue({
    status: "success",
    data: [],
    truncated: false,
  }),
}));

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

async function openMap(detections) {
  fetchDetections.mockResolvedValue({ detections, threshold: 20, counts: {} });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "Explore" }));
  return user;
}

describe("detection age switch (#48 usability)", () => {
  it("shows only the last 24 hours, or only older records", async () => {
    const user = await openMap([
      { id: 1, latitude: 50, longitude: -120, timestamp: hoursAgo(2), confidence: 80, classification: "potential_wildfire", meets_threshold: true },
      { id: 2, latitude: 55, longitude: -115, timestamp: hoursAgo(24 * 30), confidence: 80, classification: "potential_wildfire", meets_threshold: true },
    ]);
    await waitFor(() => expect(screen.getAllByTestId("fire-marker")).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: "Last 24 h" }));
    expect(screen.getAllByTestId("fire-marker").map((m) => m.dataset.position)).toEqual(["50,-120"]);

    await user.click(screen.getByRole("button", { name: "Historical" }));
    expect(screen.getAllByTestId("fire-marker").map((m) => m.dataset.position)).toEqual(["55,-115"]);

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getAllByTestId("fire-marker")).toHaveLength(2);
  });

  it("says so when there are no detections in the last 24 hours", async () => {
    const user = await openMap([
      { id: 2, latitude: 55, longitude: -115, timestamp: hoursAgo(24 * 30), confidence: 80, classification: "potential_wildfire", meets_threshold: true },
    ]);
    await waitFor(() => expect(screen.getAllByTestId("fire-marker")).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Last 24 h" }));
    expect(screen.queryAllByTestId("fire-marker")).toHaveLength(0);
    expect(screen.getByRole("status", { name: "" }).textContent).toMatch(/No satellite detections in the last 24 hours/);
  });
});
