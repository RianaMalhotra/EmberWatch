import { describe, expect, it } from "vitest";
import { MODEL, predictWeatherPattern, summarizeDay } from "./weatherClassifier";
const weather={temperature_2m:25,relative_humidity_2m:30,wind_speed_10m:15,precipitation:0};
describe("trained historical-weather model",()=>{
 it("uses fitted coefficients from labeled examples",()=>{expect(MODEL.training_examples).toBe(21);expect(MODEL.weights).toHaveLength(5);});
 it("returns a bounded similarity score",()=>{const n=predictWeatherPattern(weather);expect(n).toBeGreaterThanOrEqual(0);expect(n).toBeLessThanOrEqual(100);});
 it("does not impute missing data",()=>{expect(predictWeatherPattern({...weather,precipitation:null})).toBeNull();});
 it("requires near-complete daily weather",()=>{expect(summarizeDay({time:["2026-11-18T00:00"],...Object.fromEntries(Object.entries(weather).map(([k,v])=>[k,[v]]))},"2026-11-18")).toBeNull();});
});
