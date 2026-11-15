import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
    MapContainer: ({ children, center, zoom, maxBounds }) => {
      // Only the dashboard map (the one with maxBounds) fails; the Report a fire map keeps working.
      if (mapFailure.explode && maxBounds) throw new Error("map exploded");
      return React.createElement("div", { "data-testid": "map", "data-center": center.join(","), "data-zoom": String(zoom) }, children);
    },

    TileLayer: () => null,
    Popup: ({ children }) => React.createElement("div", { "data-testid": "leaflet-popup" }, children),
    Tooltip: ({ children }) =>
      React.createElement("span", { role: "tooltip" }, children),
    useMap: () => mockMap,
    useMapEvents: () => mockMap,

    Circle: ({ center, radius, pathOptions }) =>
      React.createElement("div", {
        "data-testid": "risk-zone",
        "data-center": center.join(", "),
        "data-radius": String(radius),
        "data-fill-opacity": String(pathOptions?.fillOpacity),
        "data-dashed": pathOptions?.dashArray ? "yes" : "no",
      }),

    Marker: ({ position, eventHandlers, children }) => React.createElement("button", { type: "button", "aria-label": `Fire at ${position.join(", ")}`, onClick: eventHandlers?.click }, children),
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

const mapFailure = vi.hoisted(() => ({ explode: false }));
const mockMap = vi.hoisted(() => ({ fitBounds: vi.fn(), panTo: vi.fn(), getBounds: () => ({ contains: () => true }) }));

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
  mapFailure.explode = false;
  vi.clearAllMocks();
});

describe("Wildfire risk map", () => {
  it("displays the map and risk areas returned by the API", async () => {
    fetchRiskAreas.mockResolvedValue({
      source: "supabase",
      data: [mockArea],
    });

    render(<App />);
    (await screen.findByRole("button", { name: "Explore map" })).click();

    expect(await screen.findByTestId("map")).toBeInTheDocument();

    expect(
      await screen.findByRole("button", {
        name: "Select area at 43.6532, -79.3832",
      }),
    ).toBeInTheDocument();

    expect(screen.getByText(/Tap a location to see its risk score/i)).toBeInTheDocument();
  });

  it("shows environmental factors when a risk area is clicked", async () => {
    const user = userEvent.setup();

    fetchRiskAreas.mockResolvedValue({
      source: "supabase",
      data: [mockArea],
    });

    render(<App />);
    (await screen.findByRole("button", { name: "Explore map" })).click();

    await user.click(
      await screen.findByRole("button", {
        name: "Select area at 43.6532, -79.3832",
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Toronto Test Area" }),
    ).toBeInTheDocument();

    expect(screen.getByText("Risk level").parentElement).toHaveTextContent("HIGH");
    expect(screen.getAllByText(/75\.0 \/ 100/).length).toBeGreaterThan(0);

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

    expect(screen.queryByRole("heading", { name: "How the risk estimate is calculated" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /View Risk Details/i }));
    expect(screen.getByRole("heading", { name: "How the risk estimate is calculated" })).toBeInTheDocument();
    expect(screen.getByLabelText("Risk factor explanations")).toHaveTextContent("Slope (5% base weight): Unavailable");
    expect(screen.getByLabelText("Risk factor explanations")).toHaveTextContent("Nearby Fire Detections (25% base weight)");
    expect(screen.getByText(/not a validated real-time fire forecast/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Back to Fire Information/i }));
    expect(screen.queryByRole("heading", { name: "How the risk estimate is calculated" })).not.toBeInTheDocument();

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
    (await screen.findByRole("button", { name: "Explore map" })).click();

    await user.click(
      await screen.findByRole("button", {
        name: "Select area at 43.6532, -79.3832",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Clear selection" }));

    expect(
      screen.getByText(/Tap a location to see its risk score/i),
    ).toBeInTheDocument();

    expect(
      screen.queryByRole("heading", { name: "Toronto Test Area" }),
    ).not.toBeInTheDocument();
  });

  it("displays an error if the risk areas API request fails", async () => {
    fetchRiskAreas.mockRejectedValue(new Error("Server unavailable"));

    render(<App />);
    (await screen.findByRole("button", { name: "Explore map" })).click();

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
    (await screen.findByRole("button", { name: "Explore map" })).click();

    const incompleteMarker = await screen.findByRole("button", { name: "Select area at 43.6532, -79.3832" });
    const completeMarker = screen.getByRole("button", { name: "Select area at 49.888, -119.496" });
    const unscoredMarker = screen.getByRole("button", { name: "Select area at 62.454, -114.372" });

    expect(incompleteMarker).toHaveAttribute("data-dashed", "yes");
    expect(completeMarker).toHaveAttribute("data-dashed", "no");
    expect(unscoredMarker).toHaveAttribute("data-dashed", "yes");
    expect(unscoredMarker).toHaveAttribute("data-color", "#6b7280");
    expect(incompleteMarker).toHaveTextContent("incomplete: missing Slope");

    expect(screen.getByLabelText("Map legend")).toHaveTextContent("incomplete");
    expect(screen.getByRole("button", { name: /close map layers and legend/i })).toBeInTheDocument();
    expect(screen.getByTestId("map")).toHaveAttribute("data-center", "54.5,-119");
    expect(screen.getByTestId("map")).toHaveAttribute("data-zoom", "6");
    expect(screen.getByText("Map legend").closest("details")).toHaveAttribute("open");
  });

  it("shades valid risk zones without fabricating values for unscored areas (#44)", async () => {
    const scored = { ...mockArea, id: 2, latitude: 49.888, longitude: -119.496,
      is_complete: true, missing_inputs: [] };
    const unscored = { ...mockArea, id: 3, latitude: 62.454, longitude: -114.372,
      risk_score: null, risk_level: null, is_complete: false,
      missing_inputs: ["temperature_c", "vegetation_index"] };
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [mockArea, scored, unscored] });

    render(<App />);
    (await screen.findByRole("button", { name: "Explore map" })).click();

    await userEvent.setup().click(screen.getByRole("checkbox", { name: /show 50 km risk zones/i }));
    const zones = await screen.findAllByTestId("risk-zone");
    expect(zones).toHaveLength(3);
    const zoneAt = (center) => zones.find((zone) => zone.dataset.center === center);
    zones.forEach((zone) => expect(zone).toHaveAttribute("data-radius", "50000"));
    expect(Number(zoneAt("49.888, -119.496").dataset.fillOpacity)).toBeGreaterThan(0);
    expect(zoneAt("49.888, -119.496")).toHaveAttribute("data-dashed", "no");
    expect(Number(zoneAt("43.6532, -79.3832").dataset.fillOpacity)).toBeGreaterThan(0);
    expect(zoneAt("43.6532, -79.3832")).toHaveAttribute("data-dashed", "yes");
    expect(zoneAt("62.454, -114.372")).toHaveAttribute("data-fill-opacity", "0");
  });

  it("toggles risk zones while preserving clickable markers (#44)", async () => {
    const user = userEvent.setup();
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [mockArea] });

    render(<App />);
    (await screen.findByRole("button", { name: "Explore map" })).click();
    expect(screen.queryAllByTestId("risk-zone")).toHaveLength(0);
    await user.click(screen.getByRole("checkbox", { name: /show 50 km risk zones/i }));
    expect(screen.queryAllByTestId("risk-zone")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Select area at 43.6532, -79.3832" })).toBeInTheDocument();
  });

  it("does not present a stale risk level when the score is missing", async () => {
    const user = userEvent.setup();
    const inconsistent = { ...mockArea, risk_score: null, risk_level: "HIGH" };
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [inconsistent] });
    render(<App />);
    (await screen.findByRole("button", { name: "Explore map" })).click();
    const marker = await screen.findByRole("button", { name: "Select area at 43.6532, -79.3832" });
    expect(marker).toHaveAttribute("data-color", "#6b7280");
    await user.click(marker);
    expect(screen.getByText("Risk level").parentElement).toHaveTextContent("Unavailable");
    expect(screen.getByText("Risk score").parentElement).toHaveTextContent("Unavailable");
  });

  it("explains when an area has no risk score", async () => {
    const user = userEvent.setup();
    const unscored = { ...mockArea, risk_score: null, risk_level: null,
      missing_inputs: ["temperature_c", "vegetation_index"] };

    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [unscored] });

    render(<App />);
    (await screen.findByRole("button", { name: "Explore map" })).click();

    await user.click(await screen.findByRole("button", { name: "Select area at 43.6532, -79.3832" }));

    expect(screen.getByText("Risk level").parentElement).toHaveTextContent("Unavailable");
    expect(screen.getByText("Risk score").parentElement).toHaveTextContent("Unavailable");
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
    (await screen.findByRole("button", { name: "Explore map" })).click();

    expect(await screen.findByText(/Nearby fire history is temporarily unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Risk could not be calculated for 1 area/)).toBeInTheDocument();
    // The areas that did load are still on the map.
    expect(screen.getByRole("button", { name: "Select area at 43.6532, -79.3832" })).toBeInTheDocument();
  });

  it("shows no notice when the API sends no warnings", async () => {
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [mockArea] });

    render(<App />);
    (await screen.findByRole("button", { name: "Explore map" })).click();

    await screen.findByRole("button", { name: "Select area at 43.6532, -79.3832" });
    expect(screen.queryByText(/Notice:/)).not.toBeInTheDocument();
  });

  it("explains a timeout in plain words (#25)", async () => {
    fetchRiskAreas.mockRejectedValue(new RequestTimeoutError(15000));

    render(<App />);
    (await screen.findByRole("button", { name: "Explore map" })).click();

    expect(await screen.findByText(/Risk data unavailable:/))
      .toHaveTextContent("The server took too long to respond.");
  });

  it("explains an unreachable server in plain words (#25)", async () => {
    fetchRiskAreas.mockRejectedValue(new TypeError("Failed to fetch"));

    render(<App />);
    (await screen.findByRole("button", { name: "Explore map" })).click();

    expect(await screen.findByText(/Risk data unavailable:/))
      .toHaveTextContent(/Can't reach the server/);
  });

  it("lets the user retry loading risk data after a failure (#25)", async () => {
    const user = userEvent.setup();
    fetchRiskAreas
      .mockRejectedValueOnce(new Error("Failed to fetch risk data: 503"))
      .mockResolvedValueOnce({ source: "supabase", data: [mockArea] });

    render(<App />);
    (await screen.findByRole("button", { name: "Explore map" })).click();

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
    (await screen.findByRole("button", { name: "Explore map" })).click();

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
    (await screen.findByRole("button", { name: "Explore map" })).click();

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
    (await screen.findByRole("button", { name: "Explore map" })).click();

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
  
  it("opens the selected detection details when a satellite marker is clicked", async () => {
    const user = userEvent.setup();

    fetchRiskAreas.mockResolvedValue({
      source: "supabase",
      data: [mockArea],
    });

    fetchDetections.mockResolvedValue({
      threshold: 20,
      detections: [
        {
          id: 201,
          latitude: 50.1,
          longitude: -120.3,
          timestamp: "2025-07-01T18:30:00Z",
          confidence: 85,
          classification: "potential_wildfire",
          meets_threshold: true,
        },
      ],
      counts: {
        total: 1,
        shown: 1,
        potential_wildfire: 1,
        low_confidence: 0,
        unavailable: 0,
      },
    });

    render(<App />);

    // Open the map.
    await user.click(
      await screen.findByRole("button", { name: "Explore map" }),
    );

    // Select an area first.
    await user.click(
      await screen.findByRole("button", {
        name: "Select area at 43.6532, -79.3832",
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Toronto Test Area" }),
    ).toBeInTheDocument();

    // Click the individual satellite detection marker.
    await user.click(
      screen.getByRole("button", {
        name: "Fire at 50.1, -120.3",
      }),
    );

    // Detection details should replace the area assessment.
    expect(
      screen.getByRole("region", {
        name: "Satellite detection details",
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: /Potential wildfire/i }),
    ).toBeInTheDocument();

    const detectionDetails = screen.getByRole("region", {
      name: "Satellite detection details",
    });

    expect(detectionDetails).toHaveTextContent("Jul 1, 2025");
    expect(detectionDetails).toHaveTextContent("50.100, -120.300");
    expect(detectionDetails).toHaveTextContent("85%");

    expect(
      screen.queryByRole("heading", { name: "Toronto Test Area" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the risk map usable when the detections API fails", async () => {
    const user = userEvent.setup();

    fetchRiskAreas.mockResolvedValue({
      source: "supabase",
      data: [mockArea],
    });

    fetchDetections.mockRejectedValue(
      new Error("Failed to fetch detections: 503"),
    );

    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Explore map" }),
    );

    // The detection failure should be reported.
    expect(await screen.findByText(/Detections unavailable:/))
      .toHaveTextContent("The data service is temporarily unavailable.");

    // The map and risk area should remain available.
    expect(screen.getByTestId("map")).toBeInTheDocument();

    const areaMarker = screen.getByRole("button", {
      name: "Select area at 43.6532, -79.3832",
    });

    expect(areaMarker).toBeInTheDocument();

    // Users should still be able to inspect the area's risk information.
    await user.click(areaMarker);

    expect(
      screen.getByRole("heading", { name: "Toronto Test Area" }),
    ).toBeInTheDocument();

    expect(screen.getByText("Risk level").parentElement)
      .toHaveTextContent("HIGH");

    // A detection failure must not trigger another risk-data request.
    expect(fetchRiskAreas).toHaveBeenCalledTimes(1);
    expect(fetchDetections).toHaveBeenCalledTimes(1);
  });

  it("supports the complete wildfire monitoring workflow", async () => {
    const user = userEvent.setup();

    fetchRiskAreas.mockResolvedValue({
      source: "supabase",
      data: [mockArea],
    });

    fetchDetections.mockResolvedValue({
      threshold: 20,
      detections: [
        {
          id: 101,
          latitude: 50.1,
          longitude: -120.3,
          timestamp: "2025-07-01T18:30:00Z",
          confidence: 80,
          classification: "potential_wildfire",
          meets_threshold: true,
        },
        {
          id: 102,
          latitude: 51.2,
          longitude: -121.4,
          timestamp: "2025-07-02T18:30:00Z",
          confidence: 10,
          classification: "low_confidence",
          meets_threshold: false,
        },
      ],
      counts: {
        total: 2,
        shown: 2,
        potential_wildfire: 1,
        low_confidence: 1,
        unavailable: 0,
      },
    });

    render(<App />);

    // 1. Open the wildfire map.
    await user.click(
      await screen.findByRole("button", { name: "Explore map" }),
    );

    expect(await screen.findByTestId("map")).toBeInTheDocument();

    // 2. Select a monitored area.
    await user.click(
      await screen.findByRole("button", {
        name: "Select area at 43.6532, -79.3832",
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Toronto Test Area" }),
    ).toBeInTheDocument();

    // 3. Inspect the risk score and environmental factors.
    expect(screen.getByText("Risk level").parentElement)
      .toHaveTextContent("HIGH");

    expect(screen.getByText(/Temperature:/).parentElement)
      .toHaveTextContent("32 °C");

    expect(screen.getByText(/Relative Humidity:/).parentElement)
      .toHaveTextContent("25 %");

    // 4. Open the risk explanation.
    await user.click(
      screen.getByRole("button", { name: /View Risk Details/i }),
    );

    expect(
      screen.getByRole("heading", {
        name: "How the risk estimate is calculated",
      }),
    ).toBeInTheDocument();

    expect(screen.getByLabelText("Risk factor explanations"))
      .toHaveTextContent("Slope (5% base weight): Unavailable");

    // 5. Return to the fire information.
    await user.click(
      screen.getByRole("button", { name: /Back to Fire Information/i }),
    );

    expect(
      screen.getByRole("heading", { name: "Toronto Test Area" }),
    ).toBeInTheDocument();

    // 6. Inspect satellite detection details.
    await user.click(
      screen.getByRole("button", { name: /Data dates & details/i }),
    );

    expect(await screen.findByText(/2 detections shown/))
      .toBeInTheDocument();

    expect(screen.getByText("Potential wildfire"))
      .toBeInTheDocument();

    expect(screen.getByText("Low confidence detection"))
      .toBeInTheDocument();

    expect(screen.getByText(/Location: 50.100, -120.300/))
      .toBeInTheDocument();

    expect(screen.getByText(/Confidence: 80%/))
      .toBeInTheDocument();
  });

  it("shows a detection-specific loading state while the request is pending", async () => {
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [mockArea] });
    fetchDetections.mockReturnValue(new Promise(() => {}));

    render(<App />);
    (await screen.findByRole("button", { name: "Explore map" })).click();
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
    (await screen.findByRole("button", { name: "Explore map" })).click();
    await userEvent.setup().click(screen.getByRole("button", { name: /Data dates & details/ }));
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
    (await screen.findByRole("button", { name: "Explore map" })).click();
    await userEvent.setup().click(screen.getByRole("button", { name: /Data dates & details/ }));
    expect(await screen.findByText(/2 detections shown/)).toBeInTheDocument();
    expect(screen.getAllByText("Potential wildfire").length).toBeGreaterThan(0);
    expect(screen.getByText("Low confidence detection")).toBeInTheDocument();
    expect(screen.getByText(/Location: 50.100, -120.300/)).toBeInTheDocument();
    expect(screen.getByText(/Confidence: 80%/)).toBeInTheDocument();
    expect(screen.getByText(/Below the 20% confidence/)).toBeInTheDocument();
    expect(screen.getByLabelText("Detection marker legend"))
      .toHaveTextContent("Detection confidence reflects the observation");
  });
});

describe("Sprint 4 failure isolation (#49)", () => {
  const emptyDetections = {
    threshold: 20,
    detections: [],
    counts: { total: 0, shown: 0, potential_wildfire: 0, low_confidence: 0, unavailable: 0 },
  };

  it("keeps showing risk areas when the detections feed fails", async () => {
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [mockArea] });
    fetchDetections.mockRejectedValue(new Error("Failed to fetch detections: 503"));

    render(<App />);

    expect(await screen.findByText(/Detections unavailable:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select area at 43.6532, -79.3832" }))
      .toBeInTheDocument();
    expect(screen.queryByText(/Risk data unavailable:/)).not.toBeInTheDocument();
  });

  it("keeps showing detections when the risk feed fails, without inventing risk areas", async () => {
    fetchRiskAreas.mockRejectedValue(new Error("Failed to fetch risk data: 503"));
    fetchDetections.mockResolvedValue({
      threshold: 20,
      detections: [{ id: 1, latitude: 50.1, longitude: -120.3, timestamp: "2026-10-01T18:30:00Z",
        confidence: 80, classification: "potential_wildfire", meets_threshold: true }],
      counts: { total: 1, shown: 1, potential_wildfire: 1, low_confidence: 0, unavailable: 0 },
    });

    render(<App />);

    expect(await screen.findByText(/Risk data unavailable:/)).toBeInTheDocument();
    await userEvent.setup().click(await screen.findByRole("button", { name: /Data dates & details/ }));
    expect(await screen.findByText(/1 detection shown/)).toBeInTheDocument();
    expect(screen.getByText("Potential wildfire", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select area at 43.6532, -79.3832" })).not.toBeInTheDocument();
  });

  it("shows both unavailable states, and Report a Fire still opens, when both feeds fail", async () => {
    const user = userEvent.setup();
    fetchRiskAreas.mockRejectedValue(new RequestTimeoutError(15000));
    fetchDetections.mockRejectedValue(new TypeError("Failed to fetch"));

    render(<App />);

    expect(await screen.findByText(/Risk data unavailable:/)).toHaveTextContent("took too long");
    expect(await screen.findByText(/Detections unavailable:/)).toHaveTextContent("Can't reach the server");
    expect(screen.queryByText(/detections shown/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Report a fire/i }));
    expect(screen.getByRole("dialog", { name: "Report a fire" })).toBeInTheDocument();
  });

  it("shows a recovery message instead of a blank page when rendering crashes", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    // The service is mocked here, so this malformed entry skips the API-layer sanitiser.
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [null] });
    fetchDetections.mockResolvedValue(emptyDetections);

    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/page could not be displayed/);
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("keeps the rest of the page usable when the map section crashes while rendering", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mapFailure.explode = true;
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [mockArea] });
    fetchDetections.mockRejectedValue(new TypeError("Failed to fetch"));

    render(<App />);

    // Only the map and details are replaced, with a retry button.
    // (Re-queried each time: the boundary retries when new data arrives, which replaces the element.)
    await screen.findByText(/map and details could not be displayed/i);
    const mapAlert = () => screen.getByText(/map and details could not be displayed/i).closest('[role="alert"]');
    expect(mapAlert()).toHaveTextContent("The rest of the page still works.");
    expect(within(mapAlert()).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText(/The page could not be displayed/)).not.toBeInTheDocument();
    const dashboardMap = () => screen.queryAllByTestId("map").find((el) => el.dataset.zoom === "6");
    expect(dashboardMap()).toBeUndefined();

    // Status messages and Report a fire are still on the page and working.
    expect(await screen.findByText(/Detections unavailable:/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Report a fire/i }));
    expect(screen.getByRole("dialog", { name: "Report a fire" })).toBeInTheDocument();

    // Once the map works again, "Try again" brings it back.
    mapFailure.explode = false;
    await user.click(within(mapAlert()).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(dashboardMap()).toBeDefined());
    expect(screen.queryByText(/map and details could not be displayed/i)).not.toBeInTheDocument();
    consoleError.mockRestore();
  });
});

describe("Weather observation time (#49)", () => {
  it("says so when an area has no weather observation, instead of showing nothing", async () => {
    const user = userEvent.setup();
    fetchDetections.mockResolvedValue({
      threshold: 20, detections: [],
      counts: { total: 0, shown: 0, potential_wildfire: 0, low_confidence: 0, unavailable: 0 },
    });
    fetchRiskAreas.mockResolvedValue({
      source: "supabase",
      data: [{ ...mockArea, observed_at: null }],
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Select area at 43.6532, -79.3832" }));
    expect(screen.getByText("Weather observation time unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/Weather observed/)).not.toBeInTheDocument();
  });
});
