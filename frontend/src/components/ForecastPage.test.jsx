import { describe, expect, it } from "vitest";
import { weatherOutlook, summarizeDay } from "./ForecastPage";
describe("experimental weather outlook", () => {
  it("never manufactures scores from missing inputs", () => {
    expect(weatherOutlook({ temperature_2m: 25, relative_humidity_2m: null, wind_speed_10m: 15, precipitation: 0 })).toBeNull();
  });
  it("scores complete inputs within 0-100", () => {
    expect(weatherOutlook({ temperature_2m: 30, relative_humidity_2m: 20, wind_speed_10m: 35, precipitation: 0 })).toBeGreaterThan(60);
  });
  it("rejects incomplete days", () => {
    expect(summarizeDay({ time: ["2026-11-18T00:00"], temperature_2m: [20], relative_humidity_2m: [], wind_speed_10m: [10], precipitation: [0] }, "2026-11-18")).toBeNull();
  });
});