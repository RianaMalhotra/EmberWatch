import model from "../data/weatherClassifier.json";
export const MODEL = model;
export const FEATURES = ["temperature_2m","relative_humidity_2m","wind_speed_10m","precipitation"];
export function predictWeatherPattern(hour) {
  const values = FEATURES.map((name) => hour?.[name]);
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  const z = model.weights[0] + values.reduce((sum, value, i) =>
    sum + model.weights[i + 1] * (value - model.means[i]) / model.scales[i], 0);
  return Math.round(100 / (1 + Math.exp(-Math.max(-30, Math.min(30, z)))));
}
export function summarizeDay(hourly, date) {
  const indices = hourly.time.map((time,i) => time.startsWith(date) ? i : -1).filter(i => i >= 0);
  const hours = indices.map(i => Object.fromEntries(FEATURES.map(name => [name,hourly[name]?.[i]])));
  const values = hours.map(predictWeatherPattern);
  if (values.length < 20 || values.some(v => v === null)) return null;
  const average = Math.round(values.reduce((a,b)=>a+b,0)/values.length);
  const peak = Math.max(...values);
  const mid = hours[Math.min(12,hours.length-1)];
  return { date, average, peak, hours:hours.length, temperature:mid.temperature_2m, humidity:mid.relative_humidity_2m, wind:mid.wind_speed_10m, precipitation:hours.reduce((a,h)=>a+h.precipitation,0) };
}
export function level(value) { return value >= 70 ? "High similarity" : value >= 40 ? "Moderate similarity" : "Lower similarity"; }
