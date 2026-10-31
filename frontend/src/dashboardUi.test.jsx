import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { fetchRiskAreas } from "./services/riskApi";
import { fetchDetections } from "./services/detectionApi";
import { sortAreasByRisk } from "./utils/riskFormat";
import { detectionSummary } from "./utils/detectionFormat";

// Usability polish for phones, keyboards and screen readers.

vi.mock("./services/riskApi", () => ({ fetchRiskAreas: vi.fn() }));
vi.mock("./services/detectionApi", () => ({ fetchDetections: vi.fn() }));

const mockMap = vi.hoisted(() => ({
  fitBounds: vi.fn(),
  panTo: vi.fn(),
  bounds: { contains: () => true },
  getBounds() { return this.bounds; },
}));

vi.mock("react-leaflet", async () => {
  const React = await import("react");
  return {
    MapContainer: ({ children }) => React.createElement("div", { "data-testid": "map" }, children),
    TileLayer: () => null,
    Popup: () => null,
    Tooltip: () => null,
    useMap: () => mockMap,
    CircleMarker: ({ center, eventHandlers }) => React.createElement(
      "button",
      { type: "button", "aria-label": `Marker at ${center.join(", ")}`, onClick: eventHandlers?.click },
      "marker",
    ),
  };
});

function area(id, name, score, level, extra = {}) {
  return {
    id, name, latitude: 49 + id, longitude: -120 + id,
    risk_score: score, risk_level: level, is_complete: true, missing_inputs: [],
    coverage: 1, factor_scores: {}, model_version: "test", observed_at: "2026-10-23T19:00:00Z",
    environmental_factors: { temperature_c: 12, relative_humidity_pct: 40, wind_speed_kmh: 5,
      precipitation_mm: 0, vegetation_index: null, slope_deg: 1, nearby_detections: 10 },
    ...extra,
  };
}

const AREAS = [
  area(1, "Kelowna", 54.1, "MODERATE", { is_complete: false, missing_inputs: ["vegetation_index"] }),
  area(2, "Lytton", 71.2, "HIGH"),
  area(3, "New area", null, null, { is_complete: false, coverage: 0.2 }),
  area(4, "Ottawa", 30.5, "LOW"),
];

let originalMatchMedia;

beforeEach(() => {
  fetchRiskAreas.mockResolvedValue({ source: "supabase", data: AREAS });
  fetchDetections.mockResolvedValue({
    threshold: 20, detections: [], gaps: [],
    counts: { total: 1, shown: 1, potential_wildfire: 1, low_confidence: 0, unavailable: 0 },
  });
  mockMap.bounds = { contains: () => true };
  originalMatchMedia = window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.matchMedia = originalMatchMedia;
  vi.unstubAllGlobals();
});

describe("area list", () => {
  it("lists every area, highest risk first and unscored last", async () => {
    render(<App />);
    const list = await screen.findByRole("navigation", { name: "Monitored areas" });
    const names = within(list).getAllByRole("button").map((b) => b.textContent);
    // name and status are separate lines in the chip

    expect(names).toEqual([
      "LyttonHigh · 71",
      "KelownaModerate · 54 · incomplete",
      "OttawaLow · 31",
      "New areaUnavailable",
    ]);
  });

  it("selects an area from the list without touching the map", async () => {
    const user = userEvent.setup();
    render(<App />);
    const lytton = await screen.findByRole("button", { name: /^Lytton/ });

    await user.click(lytton);

    expect(screen.getByRole("heading", { level: 2, name: "Lytton" })).toBeInTheDocument();
    expect(screen.getByText(/Risk: HIGH/)).toBeInTheDocument();
    expect(lytton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Ottawa/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("pans the map to an area that is off screen", async () => {
    mockMap.bounds = { contains: () => false };
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /^Ottawa/ }));

    expect(mockMap.panTo).toHaveBeenCalledWith([53, -116]);
  });

  it("does not move the map when the area is already visible", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Ottawa/ }));
    expect(mockMap.panTo).not.toHaveBeenCalled();
  });

  it("sorts ties by name", () => {
    const sorted = sortAreasByRisk([area(1, "B", 40, "MODERATE"), area(2, "A", 40, "MODERATE")]);
    expect(sorted.map((a) => a.name)).toEqual(["A", "B"]);
  });
});

describe("phone layout", () => {
  it("scrolls to the details after tapping an area when the panel is under the map", async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Marker at 51, -118" }));

    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 860px)");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" }));
    expect(screen.getByRole("complementary", { name: "Area details" })).toHaveFocus();
    expect(screen.getByRole("heading", { level: 2, name: "Lytton" })).toBeInTheDocument();
    delete Element.prototype.scrollIntoView;
  });

  it("does not scroll on wide screens where the panel is beside the map", async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Marker at 51, -118" }));

    expect(scrollIntoView).not.toHaveBeenCalled();
    delete Element.prototype.scrollIntoView;
  });
});

describe("details panel and legend", () => {
  it("keeps the model explanation collapsed until asked for", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Lytton/ }));

    const explanation = screen.getByLabelText("Risk factor explanations").closest("details");
    expect(explanation).not.toHaveAttribute("open");

    await user.click(screen.getByText("How the risk estimate is calculated"));
    expect(explanation).toHaveAttribute("open");
  });

  it("explains detection markers as well as risk areas", async () => {
    render(<App />);
    const legend = await screen.findByLabelText("Map legend");
    expect(legend).toHaveTextContent("Risk areas");
    expect(legend).toHaveTextContent("Satellite detections");
    expect(legend).toHaveTextContent("Potential wildfire");
    expect(legend).toHaveTextContent("Low confidence");
  });

  it("clears the selection and returns to the hint", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Kelowna/ }));
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByText(/choose an area from the list/i)).toBeInTheDocument();
  });
});

describe("detection summary wording", () => {
  it("uses the singular for one detection", () => {
    const one = { threshold: 20, detections: [{}], counts: { shown: 1, potential_wildfire: 1, low_confidence: 0 } };
    expect(detectionSummary(one)).toMatch(/^1 detection shown:/);
  });
});
