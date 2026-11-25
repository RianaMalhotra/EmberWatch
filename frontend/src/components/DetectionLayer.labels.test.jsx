// Flame markers need an accessible name (title/alt), so screen-reader and
// keyboard users know what each marker is. Labels match #115.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(cleanup);

vi.mock("react-leaflet", async () => {
  const React = await import("react");
  return {
    Marker: ({ title, alt, children }) => React.createElement("div", { "data-testid": "marker", title, "data-alt": alt }, children),
    Popup: ({ children }) => React.createElement("div", null, children),
  };
});

import DetectionLayer from "./DetectionLayer";

const detection = (id, latitude, longitude, classification = "potential_wildfire") => ({
  id, latitude, longitude, classification, confidence: 80, meets_threshold: classification !== "low_confidence",
  timestamp: "2026-11-17T21:14:00Z",
});

describe("DetectionLayer marker labels", () => {
  it("names single hotspots by confidence", () => {
    render(<DetectionLayer zoom={12} threshold={20} onSelectDetection={() => {}} onZoomToCluster={() => {}}
      detections={[detection(1, 50, -100), detection(2, 55, -110, "low_confidence")]} />);
    const titles = screen.getAllByTestId("marker").map((m) => m.getAttribute("title"));
    expect(titles).toContain("Satellite observation, meets confidence threshold");
    expect(titles).toContain("Satellite observation, low confidence");
    screen.getAllByTestId("marker").forEach((m) => expect(m.getAttribute("data-alt")).toBe("Satellite heat observation"));
  });

  it("explains that confidence is not area risk (#48 usability, task 3)", () => {
    render(<DetectionLayer zoom={12} threshold={20} onSelectDetection={() => {}} onZoomToCluster={() => {}}
      detections={[detection(1, 50, -100)]} />);
    expect(screen.getByText(/how sure the satellite is that this spot is a heat source/i)).toBeInTheDocument();
    expect(screen.getByText(/not the area's wildfire risk/i)).toBeInTheDocument();
  });

  it("names clusters by how many observations they hold", () => {
    render(<DetectionLayer zoom={3} threshold={20} onSelectDetection={() => {}} onZoomToCluster={() => {}}
      detections={[detection(1, 51, -101), detection(2, 51.01, -101.01), detection(3, 51.02, -101.02)]} />);
    const [marker] = screen.getAllByTestId("marker");
    expect(marker.getAttribute("title")).toBe("3 satellite observations");
  });
});
