import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DetectionHistoryExplorer from "./DetectionHistoryExplorer";
import { fetchFireHistory } from "../services/detectionApi";

vi.mock("../services/detectionApi", () => ({
  fetchFireHistory: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function search(user) {
  await user.type(screen.getByLabelText("History start date"), "2025-07-01");
  await user.type(screen.getByLabelText("History end date"), "2025-07-03");
  await user.click(screen.getByRole("button", { name: "Search history" }));
}

describe("Sprint 5 historical fire records (#54)", () => {
  it("does not query until submitted, then uses an exclusive UTC end boundary", async () => {
    const user = userEvent.setup();

    fetchFireHistory.mockResolvedValue({
      status: "success",
      data: [],
      truncated: false,
    });

    render(<DetectionHistoryExplorer onExplore={() => {}} />);

    expect(fetchFireHistory).not.toHaveBeenCalled();

    await search(user);

    await waitFor(() =>
      expect(fetchFireHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          south: 42,
          north: 83,
          west: -141,
          east: -52,
          start: "2025-07-01T00:00:00.000Z",
          end: "2025-07-04T00:00:00.000Z",
          limit: 200,
        })
      )
    );

    expect(
      await screen.findByText(/No historical records matched/)
    ).toBeInTheDocument();
  });

  it("shows actual satellite observations and signals truncated results", async () => {
    const user = userEvent.setup();

    fetchFireHistory.mockResolvedValue({
      status: "success",
      data: [
        {
          id: 12,
          event_type: "satellite_detection",
          latitude: 50.1,
          longitude: -120.3,
          event_at: "2025-07-02T12:00:00Z",
          confidence: 81,
          source: "NASA FIRMS",
        },
      ],
      truncated: true,
    });

    render(<DetectionHistoryExplorer onExplore={() => {}} />);

    await search(user);

    expect(await screen.findByText("81%")).toBeInTheDocument();
    expect(screen.getByText(/Only the first set of results is shown on the map/)).toBeInTheDocument();
    expect(
      screen.getByText(/not the modeled environmental risk score/)
    ).toBeInTheDocument();
  });

  it("passes only returned public records and submitted bounds to historical map", async () => {
    const user = userEvent.setup();
    const onShowOnMap = vi.fn();
    const record = { id: 12, event_type: "satellite_detection", latitude: 50.1, longitude: -120.3, event_at: "2025-07-02T12:00:00Z" };
    fetchFireHistory.mockResolvedValue({ status: "success", data: [record], truncated: true });
    render(<DetectionHistoryExplorer onShowOnMap={onShowOnMap} />);
    await search(user);
    await user.selectOptions(screen.getByLabelText("Region"), "west");
    await waitFor(() => expect(onShowOnMap).toHaveBeenCalledWith({
      query: expect.objectContaining({ west: -141, east: -52, start: "2025-07-01T00:00:00.000Z" }),
      records: [record],
      truncated: true,
    }));
    expect(screen.queryByRole("button", { name: "Show results on map" })).not.toBeInTheDocument();
  });

  it("shows a recoverable error without manufacturing observations", async () => {
    const user = userEvent.setup();

    fetchFireHistory
      .mockRejectedValueOnce(
        new Error("Historical fire records unavailable: 503")
      )
      .mockResolvedValueOnce({
        status: "success",
        data: [],
        truncated: false,
      });

    render(<DetectionHistoryExplorer onExplore={() => {}} />);

    await search(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("503");

    expect(
      screen.queryByText(/historical records returned/)
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Search history" }));

    expect(
      await screen.findByText(/No historical records matched/)
    ).toBeInTheDocument();
  });

  it("keeps pending results associated with the submitted region when controls change", async () => {
    const user = userEvent.setup();
    let resolve;

    fetchFireHistory.mockReturnValueOnce(
      new Promise(done => {
        resolve = done;
      })
    );

    render(<DetectionHistoryExplorer onExplore={() => {}} />);

    await search(user);

    await user.selectOptions(screen.getByLabelText("Region"), "west");

    await act(async () => {
      resolve({
        status: "success",
        data: [],
        truncated: false,
      });
    });

    expect(
      await screen.findByText(/Results for All Canada/)
    ).toBeInTheDocument();

    expect(fetchFireHistory).toHaveBeenCalledTimes(1);

    fetchFireHistory.mockResolvedValueOnce({
      status: "success",
      data: [],
      truncated: false,
    });

    await user.click(screen.getByRole("button", { name: "Search history" }));

    expect(
      await screen.findByText(/Results for Western Canada/)
    ).toBeInTheDocument();

    expect(fetchFireHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({
        west: -140,
        east: -110,
      })
    );
  });

  it("keeps a staff-selected report visible when it is missing from truncated history results", async () => {
    const selectedReport = {
      id: 9876,
      latitude: 50.1234,
      longitude: -120.5678,
      observed_at: "2025-07-02T12:00:00Z",
      created_at: "2025-07-02T12:30:00Z",
      review_status: "rejected",
    };

    fetchFireHistory.mockResolvedValue({
      status: "success",
      data: [
        {
          id: 12,
          event_type: "satellite_detection",
          latitude: 50.1,
          longitude: -120.3,
          event_at: "2025-07-02T13:00:00Z",
          source: "NASA FIRMS",
        },
      ],
      truncated: true,
    });

    render(
      <DetectionHistoryExplorer
        onExplore={() => {}}
        searchRequest={{
          reportId: selectedReport.id,
          latitude: selectedReport.latitude,
          longitude: selectedReport.longitude,
          observedAt: selectedReport.observed_at,
          report: selectedReport,
        }}
      />
    );

    const selectedRow = await screen.findByText("Community report");

    expect(selectedRow).toBeInTheDocument();
    expect(
      document.getElementById("history-community_report-9876")
    ).toBeInTheDocument();

    expect(
      document.getElementById("history-community_report-9876")
    ).toHaveTextContent("Rejected");

    expect(screen.getByText(/Only the first set of results is shown on the map/)).toBeInTheDocument();
  });
  
  it("clears historical results and resets the map through its callback", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    fetchFireHistory.mockResolvedValue({ status: "success", data: [], truncated: false });
    render(<DetectionHistoryExplorer onClear={onClear} />);
    await search(user);
    await screen.findByText(/No historical records matched/);
    await user.click(screen.getByRole("button", { name: "Clear history" }));
    expect(screen.queryByText(/historical records returned/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("History start date")).toHaveValue("");
    expect(screen.getByLabelText("History end date")).toHaveValue("");
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("requires dates and keeps navigation functional", async () => {
    const user = userEvent.setup();
    const onExplore = vi.fn();

    render(<DetectionHistoryExplorer onExplore={onExplore} />);

    expect(
      screen.getByRole("button", { name: "Search history" })
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Open current map" }));

    expect(onExplore).toHaveBeenCalledOnce();
    expect(fetchFireHistory).not.toHaveBeenCalled();
  });
});