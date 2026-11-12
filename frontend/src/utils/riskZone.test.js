import { describe, expect, it } from "vitest";
import { UNAVAILABLE_COLOR, RISK_COLORS } from "./riskFormat";
import {
  RISK_ZONE_RADIUS_M,
  ZONE_MAX_FILL,
  ZONE_MIN_FILL,
  riskZoneStyle,
} from "./riskZone";

const complete = (score, level) => ({ risk_score: score, risk_level: level, is_complete: true, missing_inputs: [] });
const incomplete = { risk_score: 55, risk_level: "MODERATE", is_complete: false, missing_inputs: ["vegetation_index"] };
const unscored = { risk_score: null, risk_level: null, is_complete: false, missing_inputs: ["temperature_c"] };
const failed = { risk_score: null, risk_level: null, is_complete: false, missing_inputs: [], processing_error: true };

describe("riskZoneStyle (#44)", () => {
  it("colours a scored zone by its risk level", () => {
    expect(riskZoneStyle(complete(85, "HIGH")).fillColor).toBe(RISK_COLORS.HIGH);
    expect(riskZoneStyle(complete(50, "MODERATE")).fillColor).toBe(RISK_COLORS.MODERATE);
    expect(riskZoneStyle(complete(10, "LOW")).fillColor).toBe(RISK_COLORS.LOW);
  });

  it("makes the fill stronger as the score rises, within fixed bounds", () => {
    const low = riskZoneStyle(complete(0, "LOW")).fillOpacity;
    const mid = riskZoneStyle(complete(50, "MODERATE")).fillOpacity;
    const high = riskZoneStyle(complete(100, "HIGH")).fillOpacity;
    expect(low).toBeCloseTo(ZONE_MIN_FILL);
    expect(high).toBeCloseTo(ZONE_MAX_FILL);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it("draws a complete zone with a solid outline", () => {
    expect(riskZoneStyle(complete(85, "HIGH")).dashArray).toBeNull();
  });

  it("draws an incomplete zone with a dashed outline but still shows its score", () => {
    const style = riskZoneStyle(incomplete);
    expect(style.dashArray).toBeTruthy();
    expect(style.fillOpacity).toBeGreaterThan(0);
  });

  it("gives an unscored area no fill, so no risk is shown for it", () => {
    for (const area of [unscored, failed, undefined, {}]) {
      const style = riskZoneStyle(area);
      expect(style.fillOpacity).toBe(0);
      expect(style.fillColor).toBe(UNAVAILABLE_COLOR);
      expect(style.dashArray).toBeTruthy();
    }
  });

  it("rejects out-of-range or unknown-level scores instead of colouring them", () => {
    expect(riskZoneStyle({ risk_score: 150, risk_level: "HIGH", is_complete: true }).fillOpacity).toBe(0);
    expect(riskZoneStyle({ risk_score: 50, risk_level: "EXTREME", is_complete: true }).fillOpacity).toBe(0);
    expect(riskZoneStyle({ risk_score: NaN, risk_level: "LOW", is_complete: true }).fillOpacity).toBe(0);
  });

  it("uses the 50 km fire-history radius the model scores with", () => {
    expect(RISK_ZONE_RADIUS_M).toBe(50_000);
  });
});
