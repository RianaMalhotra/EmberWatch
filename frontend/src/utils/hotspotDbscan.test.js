import { describe, expect, it } from "vitest";
import { distanceKm, findHotspotClusters } from "./hotspotDbscan";

const point = (latitude, longitude, id, classification = "potential_wildfire") =>
  ({ id, latitude, longitude, classification, timestamp: "2026-11-01T00:00:00Z" });

describe("DBSCAN hotspot discovery", () => {
  it("calculates geodesic distances", () => {
    expect(distanceKm(point(0, 0), point(0, 0))).toBe(0);
    expect(distanceKm(point(0, 0), point(0, 1))).toBeCloseTo(111.2, 0);
  });
  it("groups dense nearby observations and excludes isolated noise", () => {
    const clusters = findHotspotClusters([
      point(45, -80, 1), point(45.01, -80.01, 2), point(45.02, -80.02, 3),
      point(60, -100, 4),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(3);
  });
  it("does not cluster low-confidence or invalid detections", () => {
    expect(findHotspotClusters([
      point(45, -80, 1), point(45.01, -80.01, 2),
      point(45.02, -80.02, 3, "low_confidence"), point(NaN, 0, 4),
    ])).toEqual([]);
  });
  it("reassigns previously visited noise when it becomes density-reachable", () => {
    const clusters = findHotspotClusters([
      point(45, -80, 1), point(45, -80.12, 2), point(45, -80.24, 3),
    ], { radiusKm: 12, minPoints: 3 });
    expect(clusters[0].count).toBe(3);
  });
  it("rejects invalid parameters and empty input", () => {
    expect(findHotspotClusters([])).toEqual([]);
    expect(() => findHotspotClusters([], { radiusKm: 0 })).toThrow(RangeError);
  });
});
