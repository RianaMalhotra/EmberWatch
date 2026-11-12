import { describe, expect, it } from "vitest";
import {
  buildReportPayload,
  formatPin,
  observedAtUtc,
  parseReportTime,
  reportProblems,
  validLocation,
} from "./reportForm";

// Fixed "now": 21 Oct 2026, 15:00 local time.
const NOW = new Date(2026, 9, 21, 15, 0, 0);
const PIN = { latitude: 49.88812, longitude: -119.49601, source: "map" };

describe("parseReportTime (prototype v2 time entry)", () => {
  it("accepts 24-hour times and sets AM/PM automatically", () => {
    expect(parseReportTime("17", "26", null)).toMatchObject({ ok: true, auto: "PM", hour24: 17, text: "5:26 PM" });
    expect(parseReportTime("0", "05", null)).toMatchObject({ ok: true, auto: "AM", hour24: 0, text: "12:05 AM" });
  });

  it("needs AM/PM for 1–12 and converts 12 correctly", () => {
    expect(parseReportTime("5", "26", null)).toMatchObject({ ok: false, msg: "Choose AM or PM" });
    expect(parseReportTime("12", "00", "AM").hour24).toBe(0);
    expect(parseReportTime("12", "00", "PM").hour24).toBe(12);
    expect(parseReportTime("9", "15", "PM").hour24).toBe(21);
  });

  it("rejects impossible or unfinished times", () => {
    expect(parseReportTime("25", "00", null).msg).toBe("Hour must be 0–23");
    expect(parseReportTime("10", "7", "AM").msg).toBe("Minutes must be 00–59");
    expect(parseReportTime("", "", null)).toEqual({ ok: false, msg: "" });
  });
});

describe("observedAtUtc", () => {
  it("uses now for 'Just now' and stores UTC", () => {
    expect(observedAtUtc("now", null, NOW).iso).toBe(NOW.toISOString());
  });

  it("uses today's date for 'Earlier today' and rejects future times", () => {
    const earlier = observedAtUtc("earlier", parseReportTime("13", "30", null), NOW);
    expect(earlier.iso).toBe(new Date(2026, 9, 21, 13, 30).toISOString());
    expect(observedAtUtc("earlier", parseReportTime("16", "00", null), NOW).ok).toBe(false);
  });
});

describe("validation and payload", () => {
  it("lists every problem in plain words", () => {
    const problems = reportProblems({ pin: null, saw: null, when: "earlier", time: parseReportTime("", "", null), description: "x".repeat(501) }, NOW);
    expect(problems).toEqual([
      "Mark where the fire is.",
      "Choose flames, smoke or both.",
      "Enter the time you saw it",
      "Details must be 500 characters or fewer.",
    ]);
  });

  it("is ready when location, sighting and time are valid", () => {
    expect(reportProblems({ pin: PIN, saw: "Smoke", when: "now", time: null, description: "" }, NOW)).toEqual([]);
  });

  it("builds the payload the backend stores", () => {
    const payload = buildReportPayload({ pin: PIN, saw: "Both", when: "now", time: null, description: "  grey smoke  " }, NOW);
    expect(payload).toEqual({
      latitude: 49.88812,
      longitude: -119.49601,
      location_source: "map",
      observed_type: "both",
      observed_at: NOW.toISOString(),
      description: "grey smoke",
    });
    expect(buildReportPayload({ pin: { ...PIN, source: "gps" }, saw: "Smoke", when: "now", description: " " }, NOW))
      .toMatchObject({ location_source: "gps", description: null });
  });

  it("checks coordinates and formats the pin", () => {
    expect(validLocation({ latitude: 91, longitude: 0 })).toBe(false);
    expect(validLocation(null)).toBe(false);
    expect(formatPin(PIN)).toBe("Point on map (49.8881° N, 119.4960° W)");
  });
});
