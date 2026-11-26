// #48 usability finding: the browser Back button left the website instead of
// returning to the previous EmberWatch page. Pages are now browser history entries.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

vi.mock("react-leaflet", async () => {
  const React = await import("react");
  const el = React.createElement;
  const map = { fitBounds() {}, flyTo() {}, setView() {}, invalidateSize() {}, getZoom: () => 6, on() {}, off() {}, getBounds: () => ({ contains: () => true }) };
  return {
    MapContainer: ({ children }) => el("div", { "data-testid": "map" }, children),
    TileLayer: () => null, Popup: () => null, Tooltip: () => null, Circle: () => null,
    CircleMarker: () => null, Marker: () => null,
    useMap: () => map, useMapEvents: () => map,
  };
});
vi.mock("./services/riskApi", () => ({ fetchRiskAreas: vi.fn().mockResolvedValue({ source: "supabase", data: [] }) }));
vi.mock("./services/detectionApi", () => ({
  fetchDetections: vi.fn().mockResolvedValue({ detections: [], threshold: 20, counts: {} }),
  fetchDetectionHistory: vi.fn().mockResolvedValue({ detections: [] }),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function currentPage() {
  return screen.getByRole("button", { name: "Explore" }).getAttribute("aria-current") === "page" ? "explore" : "other";
}

describe("browser history (#48 usability)", () => {
  it("adds a history entry per page so Back returns to the previous page", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(window.location.hash).toBe("");

    await user.click(screen.getByRole("button", { name: "Explore" }));
    expect(window.location.hash).toBe("#explore");
    expect(currentPage()).toBe("explore");

    // Simulate the browser Back button.
    await act(async () => {
      window.history.back();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(window.location.hash).toBe("");
    expect(currentPage()).toBe("other");
  });

  it("opens the page named in the address, e.g. a shared #explore link", () => {
    window.history.replaceState(null, "", "/#explore");
    render(<App />);
    expect(currentPage()).toBe("explore");
  });

  it("ignores unknown addresses and opens the home page", () => {
    window.history.replaceState(null, "", "/#not-a-page");
    render(<App />);
    expect(currentPage()).toBe("other");
  });

  it("keeps query parameters such as ?perf=1 when changing page", async () => {
    window.history.replaceState(null, "", "/?perf=1");
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Explore" }));
    expect(window.location.search).toBe("?perf=1");
    expect(window.location.hash).toBe("#explore");
  });
});
