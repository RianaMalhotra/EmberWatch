import { detectionPeriod, weatherFreshness } from "../utils/dataFreshness";
import "./DataFreshness.css";

// One line per data source saying how old it is. Plain text, no live-region
// role: it is context, not an alert.
export default function DataFreshness({ areas, detections, now }) {
  const weather = weatherFreshness(areas, now);
  const period = detectionPeriod(detections, now);
  if (!weather && !period) return null;

  return (
    <div className="freshness" aria-label="Data freshness">
      {weather && (
        <p className={weather.stale ? "freshness-line is-stale" : "freshness-line"}>{weather.text}</p>
      )}
      {period && (
        <p className={period.historical ? "freshness-line is-history" : "freshness-line"}>{period.text}</p>
      )}
    </div>
  );
}
