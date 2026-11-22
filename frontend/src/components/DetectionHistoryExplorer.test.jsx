import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DetectionHistoryExplorer from "./DetectionHistoryExplorer";
import { fetchDetectionHistory } from "../services/detectionApi";

vi.mock("../services/detectionApi", () => ({ fetchDetectionHistory: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function search(user) {
  await user.type(screen.getByLabelText("History start date"), "2025-07-01");
  await user.type(screen.getByLabelText("History end date"), "2025-07-03");
  await user.click(screen.getByRole("button", { name: "Search history" }));
}

describe("Sprint 6 history workflow (#58)", () => {
  it("does not query until submitted, then uses inclusive calendar end with UTC exclusive boundary", async () => {
    const user = userEvent.setup();
    fetchDetectionHistory.mockResolvedValue({ detections: [], truncated: false });
    render(<DetectionHistoryExplorer onExplore={() => {}} />);
    expect(fetchDetectionHistory).not.toHaveBeenCalled();
    await search(user);
    await waitFor(() => expect(fetchDetectionHistory).toHaveBeenCalledWith(expect.objectContaining({
      south: 42, north: 83, west: -141, east: -52,
      start: "2025-07-01T00:00:00.000Z", end: "2025-07-04T00:00:00.000Z", limit: 200,
    })));
    expect(await screen.findByText(/No stored observations matched/)).toBeInTheDocument();
  });

  it("shows actual observations, not modeled risk, and signals truncated results", async () => {
    const user = userEvent.setup();
    fetchDetectionHistory.mockResolvedValue({ detections: [{
      id: 12, latitude: 50.1, longitude: -120.3,
      timestamp: "2025-07-02T12:00:00Z", confidence: 81,
      classification: "potential_wildfire",
    }], truncated: true });
    render(<DetectionHistoryExplorer onExplore={() => {}} />);
    await search(user);
    expect(await screen.findByText("81%")).toBeInTheDocument();
    expect(screen.getByText(/result limit was reached/)).toBeInTheDocument();
    expect(screen.getByText(/not the modeled environmental risk score/)).toBeInTheDocument();
  });

  it("shows a recoverable error without manufacturing observations", async () => {
    const user = userEvent.setup();
    fetchDetectionHistory.mockRejectedValueOnce(new Error("Failed to fetch detection history: 503"));
    fetchDetectionHistory.mockResolvedValueOnce({ detections: [], truncated: false });
    render(<DetectionHistoryExplorer onExplore={() => {}} />);
    await search(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("503");
    expect(screen.queryByText(/historical observations returned/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Search history" }));
    expect(await screen.findByText(/No stored observations matched/)).toBeInTheDocument();
  });

  it("requires dates and keeps navigation functional", async () => {
    const user = userEvent.setup();
    const onExplore = vi.fn();
    render(<DetectionHistoryExplorer onExplore={onExplore} />);
    expect(screen.getByRole("button", { name: "Search history" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Open current map" }));
    expect(onExplore).toHaveBeenCalledOnce();
    expect(fetchDetectionHistory).not.toHaveBeenCalled();
  });
});
