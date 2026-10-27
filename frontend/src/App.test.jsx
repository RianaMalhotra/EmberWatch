import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { fetchRiskAreas } from "./services/riskApi";
import { fetchDetections } from "./services/detectionApi";

vi.mock("./services/riskApi", () => ({
  fetchRiskAreas: vi.fn(),
}));

vi.mock("react-leaflet", async () => {
  const React = await import("react");

  return {
    MapContainer: ({ children }) =>
      React.createElement("div", { "data-testid": "map" }, children),

    TileLayer: () => null,
    Popup: () => null,
    Tooltip: ({ children }) =>
      React.createElement("span", { role: "tooltip" }, children),
    useMap: () => mockMap,

    CircleMarker: ({ center, eventHandlers, pathOptions, children }) =>
      React.createElement(
        "button",
        {
          type: "button",
          "aria-label": `Select area at ${center.join(", ")}`,
          "data-color": pathOptions?.color,
          "data-dashed": pathOptions?.dashArray ? "yes" : "no",
          onClick: eventHandlers?.click,
        },
        "Select area",
        children,
      ),
  };
});

const mockMap = vi.hoisted(() => ({ fitBounds: vi.fn() }));

vi.mock("./services/detectionApi", () => ({
  fetchDetections: vi.fn().mockRejectedValue(new Error("not under test")),
}));

const mockArea = {
  id: 1,
  name: "Toronto Test Area",
  latitude: 43.6532,
  longitude: -79.3832,
  risk_score: 75,
  risk_level: "HIGH",
  is_complete: false,
  missing_inputs: ["slope_deg"],
  coverage: 0.8,
  factor_scores: {},
  model_version: "test",
  observed_at: "2026-10-16T12:00:00",
  environmental_factors: {
    temperature_c: 32,
    relative_humidity_pct: 25,
    wind_speed_kmh: 35,
    precipitation_mm: 0,
    vegetation_index: 0.25,
    slope_deg: null,
    nearby_detections: 2,
  },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Wildfire risk map", () => {
  it("displays the map and risk areas returned by the API", async () => {
    fetchRiskAreas.mockResolvedValue({
      source: "supabase",
      data: [mockArea],
    });

    render(<App />);

    expect(await screen.findByTestId("map")).toBeInTheDocument();

    expect(
      await screen.findByRole("button", {
        name: "Select area at 43.6532, -79.3832",
      }),
    ).toBeInTheDocument();

    expect(screen.getByText(/Click a colored circle/i)).toBeInTheDocument();
  });

  it("shows environmental factors when a risk area is clicked", async () => {
    const user = userEvent.setup();

    fetchRiskAreas.mockResolvedValue({
      source: "supabase",
      data: [mockArea],
    });

    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: "Select area at 43.6532, -79.3832",
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Toronto Test Area" }),
    ).toBeInTheDocument();

    expect(screen.getByText(/Risk: HIGH/)).toBeInTheDocument();
    expect(screen.getByText(/75\.0 \/ 100/)).toBeInTheDocument();

    expect(screen.getByText(/Temperature:/).parentElement)
      .toHaveTextContent("32 °C");

    expect(screen.getByText(/Relative Humidity:/).parentElement)
      .toHaveTextContent("25 %");

    expect(screen.getByText(/Wind Speed:/).parentElement)
      .toHaveTextContent("35 km/h");

    expect(screen.getByText(/Precipitation:/).parentElement)
      .toHaveTextContent("0 mm");

    expect(screen.getByText(/Vegetation Index:/).parentElement)
      .toHaveTextContent("0.25");

    expect(screen.getByText(/Slope:/).parentElement)
      .toHaveTextContent("Unavailable");

    expect(screen.getByText(/Nearby Fire Detections:/).parentElement)
      .toHaveTextContent("2");

    expect(screen.getByText(/Some inputs are missing/i))
      .toBeInTheDocument();
  });

  it("clears the selected area's details", async () => {
    const user = userEvent.setup();

    fetchRiskAreas.mockResolvedValue({
      source: "supabase",
      data: [mockArea],
    });

    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: "Select area at 43.6532, -79.3832",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Clear selection" }));

    expect(
      screen.getByText(/Click a colored circle/i),
    ).toBeInTheDocument();

    expect(
      screen.queryByRole("heading", { name: "Toronto Test Area" }),
    ).not.toBeInTheDocument();
  });

  it("displays an error if the risk areas API request fails", async () => {
    fetchRiskAreas.mockRejectedValue(new Error("Server unavailable"));

    render(<App />);

    expect(
      await screen.findByText(/Risk data unavailable:/),
    ).toHaveTextContent("Server unavailable");

    await waitFor(() => {
      expect(fetchRiskAreas).toHaveBeenCalledTimes(1);
    });
  });

  it("draws incomplete areas dashed and unscored areas grey (#28)", async () => {
    const complete = { ...mockArea, id: 2, latitude: 49.888, longitude: -119.496,
      is_complete: true, missing_inputs: [] };
    const unscored = { ...mockArea, id: 3, latitude: 62.454, longitude: -114.372,
      risk_score: null, risk_level: null, is_complete: false,
      missing_inputs: ["temperature_c", "relative_humidity_pct", "wind_speed_kmh", "vegetation_index"] };

    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [mockArea, complete, unscored] });

    render(<App />);

    const incompleteMarker = await screen.findByRole("button", { name: "Select area at 43.6532, -79.3832" });
    const completeMarker = screen.getByRole("button", { name: "Select area at 49.888, -119.496" });
    const unscoredMarker = screen.getByRole("button", { name: "Select area at 62.454, -114.372" });

    expect(incompleteMarker).toHaveAttribute("data-dashed", "yes");
    expect(completeMarker).toHaveAttribute("data-dashed", "no");
    expect(unscoredMarker).toHaveAttribute("data-dashed", "yes");
    expect(unscoredMarker).toHaveAttribute("data-color", "#6b7280");
    expect(incompleteMarker).toHaveTextContent("incomplete: missing Slope");

    expect(screen.getByLabelText("Map legend")).toHaveTextContent("incomplete");
    expect(mockMap.fitBounds).toHaveBeenCalled();
  });

  it("explains when an area has no risk score", async () => {
    const user = userEvent.setup();
    const unscored = { ...mockArea, risk_score: null, risk_level: null,
      missing_inputs: ["temperature_c", "vegetation_index"] };

    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [unscored] });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Select area at 43.6532, -79.3832" }));

    expect(screen.getByText(/Risk: Unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Not enough input data/i);
    expect(screen.getByText(/Missing inputs:/).parentElement)
      .toHaveTextContent("Temperature, Vegetation Index");
    expect(screen.queryByText(/Some inputs are missing/i)).not.toBeInTheDocument();
  });
});

describe("Sprint 3 detection dashboard integration (#43)", () => {
  it("renders classified detection markers alongside risk areas", async () => {
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [mockArea] });
    fetchDetections.mockResolvedValue({
      threshold: 70,
      detections: [{
        id: 501, latitude: 48.1, longitude: -89.2,
        confidence: 92, classification: "potential_wildfire",
        meets_threshold: true, timestamp: "2026-10-20T12:00:00Z",
      }],
      counts: { shown: 1, potential_wildfire: 1, low_confidence: 0, unavailable: 0 },
    });
    render(<App />);
    expect(await screen.findByText(/1 detections shown:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select area at 48.1, -89.2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select area at 43.6532, -79.3832" })).toBeInTheDocument();
  });

  it("preserves the risk map when detection retrieval fails", async () => {
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [mockArea] });
    fetchDetections.mockRejectedValue(new Error("Detection service unavailable"));
    render(<App />);
    expect(await screen.findByText(/Detections unavailable:/)).toHaveTextContent("Detection service unavailable");
    expect(await screen.findByRole("button", { name: "Select area at 43.6532, -79.3832" })).toBeInTheDocument();
  });

  it("shows an explicit empty detection state without creating markers", async () => {
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [] });
    fetchDetections.mockResolvedValue({
      threshold: 70, detections: [],
      counts: { shown: 0, potential_wildfire: 0, low_confidence: 0, unavailable: 0 },
    });
    render(<App />);
    expect(await screen.findByText(/No wildfire detections available/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Select area at/ })).not.toBeInTheDocument();
  });
});
