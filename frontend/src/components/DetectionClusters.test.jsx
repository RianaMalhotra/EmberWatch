import { describe, expect, it } from "vitest";
import { clusterDetections } from "./DetectionClusters";

const observations = [
  { id: 1, latitude: 50.1, longitude: -120.1 },
  { id: 2, latitude: 50.2, longitude: -120.2 },
  { id: 3, latitude: 55.1, longitude: -110.1 },
];

describe("satellite detection clustering", () => {
  it("preserves individual detections when zoomed in", () => {
    const clusters = clusterDetections(observations, 8);
    expect(clusters).toHaveLength(3);
    expect(clusters.every((cluster) => cluster.items.length === 1)).toBe(true);
  });
  it("groups nearby observations at national zoom", () => {
    const clusters = clusterDetections(observations, 3);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.items.length).sort()).toEqual([1, 2]);
  });
  it("does not create clusters for missing coordinates", () => {
    expect(clusterDetections([{ id: 4, latitude: null, longitude: NaN }], 3)).toHaveLength(0);
  });
  it("gives a lone detection the same key at every zoom level (#48)", () => {
    const keyAt = (zoom) => clusterDetections(observations, zoom).find((c) => c.items[0].id === 3).key;
    expect(new Set([3, 4, 5, 6, 8, 10].map(keyAt))).toEqual(new Set(["3"]));
  });
  it("never lets a cluster key collide with a detection id", () => {
    const keys = clusterDetections(observations, 3).map((c) => c.key);
    expect(keys).toContain("3");
    expect(keys.find((key) => key !== "3")).toMatch(/^cluster-/);
  });
});
