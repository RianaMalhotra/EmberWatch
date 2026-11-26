import { describe, expect, it } from "vitest";
import { filterDetectionsByAge, isRecent } from "./detectionAge";

const NOW = Date.parse("2026-11-23T18:00:00Z");
const at = (iso, id) => ({ id, timestamp: iso });
const detections = [
  at("2026-11-23T17:00:00Z", 1),  // 1 h ago: recent
  at("2026-11-22T18:30:00Z", 2),  // 23.5 h ago: recent
  at("2026-11-22T17:00:00Z", 3),  // 25 h ago: historical
  at("2025-12-01T00:00:00Z", 4),  // last year: historical
  at("not a date", 5),            // unknown time: historical, never "current"
];

describe("detection age filter (#48 usability)", () => {
  it("treats the last 24 hours as recent", () => {
    expect(filterDetectionsByAge(detections, "recent", NOW).map((d) => d.id)).toEqual([1, 2]);
  });
  it("puts everything else under historical", () => {
    expect(filterDetectionsByAge(detections, "historical", NOW).map((d) => d.id)).toEqual([3, 4, 5]);
  });
  it("shows everything for 'all'", () => {
    expect(filterDetectionsByAge(detections, "all", NOW)).toHaveLength(5);
  });
  it("never calls a future timestamp recent", () => {
    expect(isRecent(at("2026-11-24T18:00:00Z"), NOW)).toBe(false);
  });
  it("handles a missing list", () => {
    expect(filterDetectionsByAge(undefined, "recent", NOW)).toEqual([]);
  });
});
