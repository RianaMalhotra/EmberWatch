import { describe, expect, it } from "vitest";
import { formatAge, lastUpdatedText, latestObservation, observationText } from "./observationFormat";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

describe("formatAge", () => {
  it.each([
    [0.2, "less than an hour ago"],
    [1, "1 hour ago"],
    [30, "30 hours ago"],
    [72, "3 days ago"],
    [-5, "less than an hour ago"],
  ])("%s h -> %s", (h, text) => {
    expect(formatAge(new Date(NOW - h * 3600 * 1000), NOW)).toBe(text);
  });
});

describe("observationText", () => {
  it("shows the time and how long ago it was", () => {
    expect(observationText({ observed_at: hoursAgo(72) }, NOW)).toMatch(/Oct 17, 2026.*\(3 days ago\)/);
  });

  it.each([undefined, null, "", "garbage"])("says there is no observation for %s", (value) => {
    expect(observationText({ observed_at: value }, NOW)).toBe("No weather observation on record");
  });
});

describe("lastUpdatedText", () => {
  it("uses the newest readable observation", () => {
    const areas = [{ observed_at: hoursAgo(100) }, { observed_at: hoursAgo(5) }, { observed_at: "bad" }, null];
    expect(latestObservation(areas).iso).toBe(hoursAgo(5));
    expect(lastUpdatedText(areas, NOW)).toMatch(/^Weather data last updated: .*\(5 hours ago\)$/);
  });

  it("returns null rather than a made-up time when nothing is readable", () => {
    expect(lastUpdatedText([{ observed_at: null }], NOW)).toBeNull();
    expect(lastUpdatedText([], NOW)).toBeNull();
  });
});
