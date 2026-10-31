import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { fetchRiskAreas } from "./services/riskApi";
import { fetchDetections } from "./services/detectionApi";
import { RequestTimeoutError } from "./services/requestHelpers";

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

    expect(screen.getByRole("heading", { name: "How the risk estimate is calculated" })).toBeInTheDocument();
    expect(screen.getByLabelText("Risk factor explanations")).toHaveTextContent("Slope (5% base weight): Unavailable");
    expect(screen.getByLabelText("Risk factor explanations")).toHaveTextContent("Nearby Fire Detections (25% base weight)");
    expect(screen.getByText(/not a validated real-time fire forecast/i)).toBeInTheDocument();

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

  it("does not present a stale risk level when the score is missing", async () => {
    const user = userEvent.setup();
    const inconsistent = { ...mockArea, risk_score: null, risk_level: "HIGH" };
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [inconsistent] });
    render(<App />);
    const marker = await screen.findByRole("button", { name: "Select area at 43.6532, -79.3832" });
    expect(marker).toHaveAttribute("data-color", "#6b7280");
    await user.click(marker);
    expect(screen.getByText(/Risk: Unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Risk Score:/).parentElement).toHaveTextContent("Unavailable");
  });

  it("explains when an area has no risk score", async () => {
    const user = userEvent.setup();
    const unscored = { ...mockArea, risk_score: null, risk_level: null,
      missing_inputs: ["temperature_c", "vegetation_index"] };

    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [unscored] });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Select area at 43.6532, -79.3832" }));

    expect(screen.getByText(/Risk: Unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Risk Score:/).parentElement).toHaveTextContent("Unavailable");
    expect(screen.getByRole("status")).toHaveTextContent(/Not enough input data/i);
    expect(screen.getByText(/Missing inputs:/).parentElement)
      .toHaveTextContent("Temperature, Vegetation Index");
    expect(screen.queryByText(/Some inputs are missing/i)).not.toBeInTheDocument();
  });

  // ---- #25 / #26: failure handling ------------------------------------

  it("shows the API's warnings next to the map (#25)", async () => {
    fetchRiskAreas.mockResolvedValue({
      source: "supabase",
      data: [mockArea],
      warnings: [
        { code: "history_unavailable", message: "Nearby fire history is temporarily unavailable, so risk scores are incomplete." },
        { code: "scoring_failed", count: 1, message: "Risk could not be calculated for 1 area(s)." },
      ],
    });

    render(<App />);

    expect(await screen.findByText(/Nearby fire history is temporarily unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Risk could not be calculated for 1 area/)).toBeInTheDocument();
    // The areas that did load are still on the map.
    expect(screen.getByRole("button", { name: "Select area at 43.6532, -79.3832" })).toBeInTheDocument();
  });

  it("shows no notice when the API sends no warnings", async () => {
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [mockArea] });

    render(<App />);

    await screen.findByRole("button", { name: "Select area at 43.6532, -79.3832" });
    expect(screen.queryByText(/Notice:/)).not.toBeInTheDocument();
  });

  it("explains a timeout in plain words (#25)", async () => {
    fetchRiskAreas.mockRejectedValue(new RequestTimeoutError(15000));

    render(<App />);

    expect(await screen.findByText(/Risk data unavailable:/))
      .toHaveTextContent("The server took too long to respond.");
  });

  it("explains an unreachable server in plain words (#25)", async () => {
    fetchRiskAreas.mockRejectedValue(new TypeError("Failed to fetch"));

    render(<App />);

    expect(await screen.findByText(/Risk data unavailable:/))
      .toHaveTextContent(/Can't reach the server/);
  });

  it("lets the user retry loading risk data after a failure (#25)", async () => {
    const user = userEvent.setup();
    fetchRiskAreas
      .mockRejectedValueOnce(new Error("Failed to fetch risk data: 503"))
      .mockResolvedValueOnce({ source: "supabase", data: [mockArea] });

    render(<App />);

    expect(await screen.findByText(/Risk data unavailable:/))
      .toHaveTextContent("The data service is temporarily unavailable.");

    await user.click(screen.getByRole("button", { name: "Try loading risk data again" }));

    expect(await screen.findByRole("button", { name: "Select area at 43.6532, -79.3832" })).toBeInTheDocument();
    expect(screen.queryByText(/Risk data unavailable:/)).not.toBeInTheDocument();
    expect(fetchRiskAreas).toHaveBeenCalledTimes(2);
  });

  it("keeps the error and offers another retry if the retry also fails (#25)", async () => {
    const user = userEvent.setup();
    fetchRiskAreas.mockRejectedValue(new Error("Failed to fetch risk data: 503"));

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Try loading risk data again" }));

    expect(await screen.findByText(/Risk data unavailable:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try loading risk data again" })).toBeInTheDocument();
    expect(fetchRiskAreas).toHaveBeenCalledTimes(2);
  });

  it("lets the user retry detections without reloading the risk areas (#25)", async () => {
    const user = userEvent.setup();
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [mockArea] });
    fetchDetections
      .mockRejectedValueOnce(new Error("Failed to fetch detections: 503"))
      .mockResolvedValueOnce({
        threshold: 20,
        detections: [],
        counts: { total: 0, shown: 0, potential_wildfire: 0, low_confidence: 0, unavailable: 0 },
      });

    render(<App />);

    expect(await screen.findByText(/Detections unavailable:/))
      .toHaveTextContent("The data service is temporarily unavailable.");

    await user.click(screen.getByRole("button", { name: "Try loading detections again" }));

    await waitFor(() => {
      expect(screen.queryByText(/Detections unavailable:/)).not.toBeInTheDocument();
    });
    expect(fetchDetections).toHaveBeenCalledTimes(2);
    expect(fetchRiskAreas).toHaveBeenCalledTimes(1);
  });

  it("says the score could not be calculated when the model failed for an area (#26)", async () => {
    const user = userEvent.setup();
    const failed = { ...mockArea, risk_score: null, risk_level: null, is_complete: false,
      missing_inputs: [], processing_error: true };
    const ok = { ...mockArea, id: 2, latitude: 49.888, longitude: -119.496,
      is_complete: true, missing_inputs: [] };

    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [failed, ok] });

    render(<App />);

    // The failed area is grey and the healthy one still shows its risk.
    const failedMarker = await screen.findByRole("button", { name: "Select area at 43.6532, -79.3832" });
    expect(failedMarker).toHaveAttribute("data-color", "#6b7280");
    expect(failedMarker).toHaveTextContent(/the score could not be calculated/i);
    expect(screen.getByRole("button", { name: "Select area at 49.888, -119.496" }))
      .toHaveAttribute("data-color", "#dc2626");

    await user.click(failedMarker);

    expect(screen.getByRole("status")).toHaveTextContent(/could not be calculated for this area/i);
    expect(screen.queryByText(/Not enough input data/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Missing inputs:/)).not.toBeInTheDocument();
  });
});

describe("Sprint 3 detection dashboard integration (#43)", () => {
  it("shows a detection-specific loading state while the request is pending", async () => {
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [mockArea] });
    fetchDetections.mockReturnValue(new Promise(() => {}));

    render(<App />);
    expect(screen.getByText("Loading wildfire detections...")).toBeInTheDocument();
    expect(screen.getByLabelText("Detection marker legend"))
      .toHaveTextContent("not the environmental wildfire risk score");
  });

  it("shows an explicit empty state independently of the risk map", async () => {
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [mockArea] });
    fetchDetections.mockResolvedValue({
      threshold: 20,
      detections: [],
      counts: { total: 0, shown: 0, potential_wildfire: 0, low_confidence: 0, unavailable: 0 },
    });

    render(<App />);
    expect(await screen.findByText(/No wildfire detections available for the latest observations/))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select area at 43.6532, -79.3832" }))
      .toBeInTheDocument();
    expect(screen.queryByText("Loading wildfire detections...")).not.toBeInTheDocument();
  });

  it("shows classified detections with location, timestamp, and confidence", async () => {
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [mockArea] });
    fetchDetections.mockResolvedValue({
      threshold: 20,
      detections: [
        { id: 101, latitude: 50.1, longitude: -120.3, timestamp: "2025-07-01T18:30:00Z",
          confidence: 80, classification: "potential_wildfire", meets_threshold: true },
        { id: 102, latitude: 51.2, longitude: -121.4, timestamp: "2025-07-02T18:30:00Z",
          confidence: 10, classification: "low_confidence", meets_threshold: false },
      ],
      counts: { total: 2, shown: 2, potential_wildfire: 1, low_confidence: 1, unavailable: 0 },
    });

    render(<App />);
    expect(await screen.findByText(/2 detections shown/)).toBeInTheDocument();
    expect(screen.getByText("Potential wildfire")).toBeInTheDocument();
    expect(screen.getByText("Low confidence detection")).toBeInTheDocument();
    expect(screen.getByText(/Location: 50.100, -120.300/)).toBeInTheDocument();
    expect(screen.getByText(/Confidence: 80%/)).toBeInTheDocument();
    expect(screen.getByText(/Below the 20% confidence/)).toBeInTheDocument();
    expect(screen.getByLabelText("Detection marker legend"))
      .toHaveTextContent("Detection confidence reflects the observation");
  });
});
