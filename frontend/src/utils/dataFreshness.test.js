import { describe, expect, it } from "vitest";
import { detectionPeriod, weatherFreshness } from "./dataFreshness";

const NOW = new Date("2026-10-31T12:00:00Z");
const UTC = "UTC";

describe("weatherFreshness", () => {
  it("uses the newest observation across all areas", () => {
    const result = weatherFreshness([
      { observed_at: "2026-10-29T19:00:00Z" },
      { observed_at: "2026-10-30T19:00:00Z" },
      { observed_at: null },
    ], NOW, UTC);
    expect(result.stale).toBe(false);
    expect(result.text).toBe("Weather data as of Oct 30, 2026.");
  });

  it("warns when the daily refresh has stopped", () => {
    const result = weatherFreshness([{ observed_at: "2026-10-23T19:00:00Z" }], NOW, UTC);
    expect(result.stale).toBe(true);
    expect(result.days).toBe(7);
    expect(result.text).toBe(
      "Weather data is 7 days old (last observed Oct 23, 2026). Risk levels may not reflect current conditions.",
    );
  });

  it("becomes stale at 3 days, not before", () => {
    expect(weatherFreshness([{ observed_at: "2026-10-28T13:00:00Z" }], NOW, UTC).stale).toBe(false);
    expect(weatherFreshness([{ observed_at: "2026-10-28T12:00:00Z" }], NOW, UTC).stale).toBe(true);
  });

  it("returns nothing when no area has an observation", () => {
    expect(weatherFreshness([{ observed_at: null }, {}], NOW)).toBeNull();
    expect(weatherFreshness([], NOW)).toBeNull();
    expect(weatherFreshness(undefined, NOW)).toBeNull();
  });

  it("ignores unreadable timestamps instead of inventing a date", () => {
    const result = weatherFreshness([{ observed_at: "not a date" }, { observed_at: "2026-10-30T19:00:00Z" }], NOW, UTC);
    expect(result.text).toBe("Weather data as of Oct 30, 2026.");
  });
});

describe("detectionPeriod", () => {
  it("labels old detections as historical with their date range", () => {
    const result = detectionPeriod([
      { timestamp: "2025-12-31T22:07:00Z" },
      { timestamp: "2025-11-23T22:24:00Z" },
    ], NOW, UTC);
    expect(result.historical).toBe(true);
    expect(result.text).toBe(
      "Satellite detections shown are from Nov 23, 2025 – Dec 31, 2025: historical records, not current fires.",
    );
  });

  it("does not call recent detections historical", () => {
    const result = detectionPeriod([{ timestamp: "2026-10-30T20:00:00Z" }, { timestamp: "2026-10-31T02:00:00Z" }], NOW, UTC);
    expect(result.historical).toBe(false);
    expect(result.text).toBe("Satellite detections shown are from Oct 30, 2026 – Oct 31, 2026.");
  });

  it("shows a single day once", () => {
    const result = detectionPeriod([{ timestamp: "2025-08-01T10:00:00Z" }, { timestamp: "2025-08-01T19:00:00Z" }], NOW, UTC);
    expect(result.text).toContain("from Aug 1, 2025:");
  });

  it("returns nothing when there are no detections", () => {
    expect(detectionPeriod([], NOW)).toBeNull();
    expect(detectionPeriod(undefined, NOW)).toBeNull();
    expect(detectionPeriod([{ timestamp: "bad" }], NOW)).toBeNull();
  });
});
