import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import HotspotDiscoveryPanel from "./HotspotDiscoveryPanel";

const group = { id: 1, count: 4, latitude: 49.123, longitude: -123.456, latestTimestamp: "2026-11-20T12:30:00Z" };

afterEach(cleanup);

describe("HotspotDiscoveryPanel", () => {
  it("explains the empty state without implying confirmed fires", () => {
    render(<HotspotDiscoveryPanel clusters={[]} onViewGroup={vi.fn()} />);
    expect(screen.getByText(/0 spatial groups/)).toBeTruthy();
    expect(screen.getByText(/No dense hotspot groups/)).toBeTruthy();
    expect(screen.getByText(/not confirmed fires or predictions/i)).toBeTruthy();
  });

  it("displays the group and formats its latest observation", () => {
    render(<HotspotDiscoveryPanel clusters={[group]} onViewGroup={vi.fn()} />);
    expect(screen.getByText(/1 spatial groups/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /View group \(4 detections\)/ })).toBeTruthy();
    expect(screen.getByText(/latest observation/).textContent).not.toContain("2026-11-20T12:30:00Z");
  });

  it("navigates to the selected group", () => {
    const onViewGroup = vi.fn();
    render(<HotspotDiscoveryPanel clusters={[group]} onViewGroup={onViewGroup} />);
    fireEvent.click(screen.getByRole("button", { name: /View group/ }));
    expect(onViewGroup).toHaveBeenCalledWith(group);
  });
});
