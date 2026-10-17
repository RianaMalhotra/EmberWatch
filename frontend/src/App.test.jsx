
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { fetchRiskAreas } from "./services/riskApi";

vi.mock("./services/riskApi", () => ({
  fetchRiskAreas: vi.fn(),
}));

vi.mock("react-leaflet", async () => {
  const React = await import("react");

  return {
    MapContainer: ({ children }) =>
      React.createElement("div", { "data-testid": "map" }, children),

    TileLayer: () => null,

    Circle: ({ center, eventHandlers }) =>
      React.createElement(
        "button",
        {
          type: "button",
          "aria-label": `Select area at ${center.join(", ")}`,
          onClick: eventHandlers?.click,
        },
        "Select area",
      ),
  };
});

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
      await screen.findByRole("alert"),
    ).toHaveTextContent("Server unavailable");

    await waitFor(() => {
      expect(fetchRiskAreas).toHaveBeenCalledTimes(1);
    });
  });
});
