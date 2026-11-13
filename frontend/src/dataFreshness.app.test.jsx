import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { fetchRiskAreas } from "./services/riskApi";
import { fetchDetections } from "./services/detectionApi";

// The dashboard says how old its data is, so old data is not taken as live.

vi.mock("./services/riskApi", () => ({ fetchRiskAreas: vi.fn() }));
vi.mock("./services/detectionApi", () => ({ fetchDetections: vi.fn() }));
vi.mock("react-leaflet", async () => {
  const React = await import("react");
  return {
    MapContainer: ({ children }) => React.createElement("div", null, children),
    TileLayer: () => null,
    Popup: () => null,
    Tooltip: () => null,
    CircleMarker: () => null,
    useMap: () => ({ fitBounds: () => {} }),
  };
});

const AREA = {
  id: 1, name: "Kelowna", latitude: 49.888, longitude: -119.496,
  risk_score: 54.1, risk_level: "MODERATE", is_complete: false, missing_inputs: ["vegetation_index"],
  coverage: 0.9, factor_scores: {}, model_version: "test", observed_at: "2026-10-23T19:00:00Z",
  environmental_factors: {},
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("data freshness on the dashboard", () => {
  it("says how old the weather is and that old detections are history", async () => {
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [AREA] });
    fetchDetections.mockResolvedValue({
      threshold: 20, gaps: [],
      detections: [
        { id: 1, latitude: 56, longitude: -111, timestamp: "2025-11-23T22:24:00Z", confidence: 90,
          classification: "potential_wildfire", meets_threshold: true },
        { id: 2, latitude: 57, longitude: -112, timestamp: "2025-12-31T22:07:00Z", confidence: 90,
          classification: "potential_wildfire", meets_threshold: true },
      ],
      counts: { total: 2, shown: 2, potential_wildfire: 2, low_confidence: 0, unavailable: 0 },
    });
    render(<App />);

    const box = await screen.findByLabelText("Data freshness");
    await waitFor(() => expect(box).toHaveTextContent("historical records, not current fires"));
    expect(box).toHaveTextContent(/Weather data (as of|is \d+ days old)/);
  });

  it("shows nothing when there is no dated data", async () => {
    fetchRiskAreas.mockResolvedValue({ source: "supabase", data: [] });
    fetchDetections.mockRejectedValue(new Error("down"));
    render(<App />);
    await screen.findByText(/No monitored areas/);
    expect(screen.queryByLabelText("Data freshness")).not.toBeInTheDocument();
  });
});
