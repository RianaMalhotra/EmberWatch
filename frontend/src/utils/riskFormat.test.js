import { describe, expect, it } from "vitest";
import {
  UNAVAILABLE_COLOR,
  areaBounds,
  missingInputNames,
  riskAreaStyle,
  riskState,
  riskStatusText,
} from "./riskFormat";

const complete = { risk_level: "HIGH", is_complete: true, missing_inputs: [] };
const incomplete = { risk_level: "LOW", is_complete: false, missing_inputs: ["vegetation_index"] };
const unscored = { risk_level: null, risk_score: null, is_complete: false, missing_inputs: ["temperature_c"] };

describe("risk area states (#28)", () => {
  it("classifies complete, incomplete and unavailable", () => {
    expect(riskState(complete)).toBe("complete");
    expect(riskState(incomplete)).toBe("incomplete");
    expect(riskState(unscored)).toBe("unavailable");
    expect(riskState(undefined)).toBe("unavailable");
  });

  it("never draws an incomplete or unscored area like a complete one", () => {
    expect(riskAreaStyle(complete).dashArray).toBeNull();
    expect(riskAreaStyle(incomplete).dashArray).toBeTruthy();
    expect(riskAreaStyle(unscored).dashArray).toBeTruthy();
    expect(riskAreaStyle(unscored).color).toBe(UNAVAILABLE_COLOR);
    expect(riskAreaStyle(unscored).fillOpacity).toBeLessThan(riskAreaStyle(incomplete).fillOpacity);
  });

  it("makes the selected area bigger", () => {
    expect(riskAreaStyle(complete, true).radius).toBeGreaterThan(riskAreaStyle(complete).radius);
  });

  it("uses readable names for missing inputs", () => {
    expect(missingInputNames(incomplete)).toEqual(["Vegetation Index"]);
    expect(missingInputNames({ missing_inputs: ["new_thing"] })).toEqual(["new_thing"]);
    expect(missingInputNames({})).toEqual([]);
  });

  it("describes each state in words", () => {
    expect(riskStatusText(complete)).toBe("HIGH risk (all inputs available).");
    expect(riskStatusText(incomplete)).toBe("LOW risk (incomplete: missing Vegetation Index).");
    expect(riskStatusText(unscored)).toMatch(/Risk unavailable/);
  });

  it("only uses valid coordinates for the map bounds", () => {
    expect(areaBounds([{ latitude: 50, longitude: -120 }, { latitude: null, longitude: 3 }]))
      .toEqual([[50, -120]]);
    expect(areaBounds(undefined)).toEqual([]);
  });
});
