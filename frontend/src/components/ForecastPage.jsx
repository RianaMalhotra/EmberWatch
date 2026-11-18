import { useEffect, useState } from "react";
import "./ForecastPage.css";

const FIELDS = "temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation";
const MAX_AGE_HOURS = 6;
function finite(value) { return typeof value === "number" && Number.isFinite(value); }
function clamp(value) { return Math.max(0, Math.min(100, value)); }

/** Experimental weather-only index. NOT a trained ML prediction or fire probability. */
export function weatherOutlook(hour) {
  if (![hour.temperature_2m, hour.relative_humidity_2m, hour.wind_speed_10m, hour.precipitation].every(finite)) return null;
  const heat = clamp((hour.temperature_2m + 5) * 2.5);
  const dryness = clamp(100 - hour.relative_humidity_2m);
  const wind = clamp(hour.wind_speed_10m * 2);
  const rain = clamp(100 - hour.precipitation * 35);
  return Math.round(0.25 * heat + 0.35 * dryness + 0.2 * wind + 0.2 * rain);
}
export function summarizeDay(hourly, day) {
  const indices = hourly.time.map((time, i) => time.startsWith(day) ? i : -1).filter((i) => i >= 0);
  const hours = indices.map((i) => ({
    time: hourly.time[i],
    temperature_2m: hourly.temperature_2m?.[i],
    relative_humidity_2m: hourly.relative_humidity_2m?.[i],
    wind_speed_10m: hourly.wind_speed_10m?.[i],
    precipitation: hourly.precipitation?.[i],
  }));
  const scores = hours.map(weatherOutlook);
  if (!hours.length || scores.some((score) => score === null)) return null;
  const peak = Math.max(...scores);
  return { date: day, peak, average: Math.round(scores.reduce((a,b) => a+b,0)/scores.length), hours: hours.length };
}
const category = (score) => score >= 70 ? "Elevated" : score >= 40 ? "Moderate" : "Lower";

export default function ForecastPage({ areas = [] }) {
  const locations = areas.filter((area) => finite(area.latitude) && finite(area.longitude) && Math.abs(area.latitude) <= 90 && Math.abs(area.longitude) <= 180);
  const [areaId, setAreaId] = useState("");
  const [state, setState] = useState({ loading: false, data: null, error: "" });
  const [refresh, setRefresh] = useState(0);
  const chosen = locations.find((area) => String(area.id) === areaId) ?? locations[0];

  useEffect(() => {
    if (!chosen) { setState({ loading: false, data: null, error: "" }); return; }
    const controller = new AbortController();
    setState({ loading: true, data: null, error: "" });
    const query = new URLSearchParams({
      latitude: String(chosen.latitude), longitude: String(chosen.longitude),
      hourly: FIELDS, forecast_days: "4", timezone: "auto",
    });
    fetch(`https://api.open-meteo.com/v1/forecast?${query}`, { signal: controller.signal })
      .then(async (res) => { if (!res.ok) throw new Error("Forecast weather service unavailable"); return res.json(); })
      .then((result) => {
        if (!result?.hourly?.time || !Array.isArray(result.hourly.time)) throw new Error("Incomplete forecast weather data");
        const dates = [...new Set(result.hourly.time.map((t) => t.slice(0,10)))].slice(0,4);
        const days = dates.map((day) => summarizeDay(result.hourly, day));
        if (days.some((day) => !day)) throw new Error("Forecast inputs are incomplete");
        setState({ loading: false, data: { days, timezone: result.timezone, updated: new Date().toISOString() }, error: "" });
      })
      .catch((error) => { if (!controller.signal.aborted) setState({ loading: false, data: null, error: error.message || "Forecast unavailable" }); });
    return () => controller.abort();
  }, [chosen?.id, chosen?.latitude, chosen?.longitude, refresh]);

  return <section className="ew-forecast" aria-label="Experimental wildfire weather outlook">
    <span className="ew-eyebrow">EMBERWATCH INTELLIGENCE · EXPERIMENTAL</span>
    <h1>AI wildfire risk forecast</h1>
    <p className="ew-forecast-intro">Explore a 4-day weather-based wildfire <strong>outlook</strong> for monitored locations. This first version uses an experimental weighted weather index, <strong>not a trained AI/ML model</strong> or a calibrated wildfire probability. ML forecasting requires a larger, independently validated historical dataset.</p>
    <div className="ew-forecast-panel">
      <div className="ew-forecast-toolbar">
        <label htmlFor="ew-forecast-area">Monitored location</label>
        <select id="ew-forecast-area" value={chosen ? String(chosen.id) : ""} onChange={(e) => setAreaId(e.target.value)} disabled={!locations.length}>
          {locations.map((area) => <option key={area.id} value={String(area.id)}>{area.name ?? `Area ${area.id}`}</option>)}
        </select>
        <button type="button" onClick={() => setRefresh((n) => n+1)} disabled={!chosen || state.loading}>Refresh forecast</button>
      </div>
      {!chosen && <p role="status">No monitored locations are available. Check the database connection and try again.</p>}
      {state.loading && <p role="status">Loading forecast weather…</p>}
      {state.error && <p role="alert">Forecast unavailable: {state.error}. No estimates are shown when data is missing.</p>}
      {state.data && <><div className="ew-forecast-grid">{state.data.days.map((day, i) => <article key={day.date}>
        <span>{i === 0 ? "Today" : i === 1 ? "Tomorrow" : `Day ${i+1}`}</span>
        <h2>{new Date(day.date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</h2>
        <strong>{day.peak}<small>/100</small></strong>
        <div className="ew-forecast-meter" aria-hidden="true"><span style={{ width: `${day.peak}%` }} /></div>
        <p>{category(day.peak)} weather-based index</p>
        <small>Daily mean: {day.average}/100</small>
      </article>)}</div>
      <p className="ew-forecast-source">Source: Open-Meteo forecast · Time zone: {state.data.timezone || "unknown"} · Retrieved: {new Date(state.data.updated).toLocaleString()}. Values represent daily peak weather index, not wildfire likelihood.</p></>}
    </div>
    <div className="ew-forecast-note"><h2>How should I interpret this?</h2><p>Higher scores indicate hotter, drier, windier or less rainy forecast conditions under a provisional formula. The index excludes vegetation, terrain, ignition sources and fire history. It is not a fire-spread model, alert, or forecast of actual wildfire occurrence. Always consult official wildfire authorities for safety decisions.</p></div>
  </section>;
}
