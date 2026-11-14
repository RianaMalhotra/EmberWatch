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
});
