import { useEffect, useState } from "react";
import { fetchDetectionHistory } from "../services/detectionApi";
import { formatConfidence, formatCoordinates, formatDetectionTime } from "../utils/detectionFormat";

const REGIONS = {
  canada: { south: 42, north: 83, west: -141, east: -52 },
  west: { south: 48, north: 60, west: -140, east: -110 },
  central: { south: 49, north: 60, west: -110, east: -80 },
  east: { south: 42, north: 60, west: -80, east: -52 },
};

// The historical endpoint requires explicit UTC instants; dates are not inferred by the server.
function utcDay(day) {
  return `${day}T00:00:00.000Z`;
}

export default function DetectionHistoryExplorer({ onExplore }) {
  const [region, setRegion] = useState("canada");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [state, setState] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState(null);

  useEffect(() => {
    if (!query) return;
    let active = true;
    setState("loading");
    setResult(null);
    setError("");
    fetchDetectionHistory({ south: query.south, north: query.north, west: query.west, east: query.east, start: query.start, end: query.end, limit: query.limit })
      .then(data => {
        if (!active) return;
        setResult(data);
        setState("ready");
      })
      .catch(err => {
        if (!active) return;
        setError(err.message || "Historical observations could not be loaded.");
        setState("error");
      });
    return () => { active = false; };
  }, [query]);

  const invalid = !start || !end || !Number.isFinite(Date.parse(utcDay(start)))
    || !Number.isFinite(Date.parse(utcDay(end))) || start > end;
  return <section className="ew-analytics-panel ew-history" aria-label="Satellite detection history">
    <h2>Satellite detection history</h2>
    <p>Query previously ingested NASA FIRMS observations by broad region and UTC date. Historical heat observations are not confirmed fires or current wildfire alerts.</p>
    <form onSubmit={event => { event.preventDefault(); if (!invalid) setQuery({ ...REGIONS[region], start: utcDay(start), end: new Date(Date.parse(utcDay(end)) + 86400000).toISOString(), limit: 200, requestedAt: Date.now() }); }}>
      <div className="ew-analytics-controls">
        <label>Region
          <select value={region} onChange={event => setRegion(event.target.value)}>
            <option value="canada">Canada (bounding box)</option>
            <option value="west">Western Canada (approximate)</option>
            <option value="central">Central Canada (approximate)</option>
            <option value="east">Eastern Canada (approximate)</option>
          </select>
        </label>
        <label>From (UTC date)<input aria-label="History start date" type="date" value={start} onChange={event => setStart(event.target.value)} required /></label>
        <label>Through (UTC date)<input aria-label="History end date" type="date" value={end} min={start || undefined} onChange={event => setEnd(event.target.value)} required /></label>
      </div>
      {start && end && start > end && <p role="alert">The end date must be on or after the start date.</p>}
      <div className="ew-analytics-actions"><button type="submit" disabled={invalid || state === "loading"}>{state === "loading" ? "Searching history…" : "Search history"}</button><button type="button" onClick={onExplore}>Open current map</button></div>
    </form>
    {state === "idle" && <p role="status">Select a region and date range to search stored observations.</p>}
    {state === "loading" && <p role="status">Loading historical satellite detections…</p>}
    {state === "error" && <p role="alert">History unavailable: {error} Existing map and risk information remain accessible.</p>}
    {state === "ready" && result && <>
      <p role="status">{result.detections.length} historical observations returned for this query.{result.truncated ? " The result limit was reached: narrow your region or date range to see more." : ""}</p>
      {result.detections.length === 0 ? <p>No stored observations matched this region and date range. This does not establish that no fires occurred.</p> :
        <div className="ew-analytics-table-wrap"><table><thead><tr><th>Observed</th><th>Location</th><th>Confidence</th><th>Classification</th></tr></thead><tbody>
          {result.detections.map((d, i) => <tr key={d.id ?? i}><td>{formatDetectionTime(d.timestamp, "UTC")}</td><td>{formatCoordinates(d.latitude, d.longitude)}</td><td>{formatConfidence(d.confidence)}</td><td>{d.classification === "low_confidence" ? "Low-confidence hotspot" : "Potential hotspot"}</td></tr>)}
        </tbody></table></div>}
      <p>Detection confidence refers to satellite observations. It is not the modeled environmental risk score for an area.</p>
    </>}
  </section>;
}
