import { forwardRef } from "react";
import {
  FACTOR_LABELS as factorLabels,
  missingInputNames,
  riskColor,
  riskState,
  validRiskScore,
} from "../utils/riskFormat";
import { formatDetectionTime } from "../utils/detectionFormat";
import { explainFactors } from "../utils/riskExplanation";

const factorUnits = {
  temperature_c: "°C",
  relative_humidity_pct: "%",
  wind_speed_kmh: "km/h",
  precipitation_mm: "mm",
  slope_deg: "°",
};

function formatFactor(key, value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Unavailable";
  return `${value}${factorUnits[key] ? ` ${factorUnits[key]}` : ""}`;
}

// Side panel (desktop) / section under the map (phone) for the selected area.
const AreaDetails = forwardRef(function AreaDetails({ area, onClear }, ref) {
  if (!area) {
    return (
      <aside ref={ref} className="panel" aria-label="Area details" tabIndex={-1}>
        <h2>Area Details</h2>
        <p className="muted">
          Click a colored circle on the map, or choose an area from the list, to view its risk
          assessment and environmental data.
        </p>
      </aside>
    );
  }

  const state = riskState(area);
  const scored = validRiskScore(area);
  const color = riskColor(area);
  const factors = area.environmental_factors ?? {};

  return (
    <aside ref={ref} className="panel" aria-label="Area details" tabIndex={-1}>
      <div className="panel-head">
        <h2>{area.name ?? `Area ${area.id}`}</h2>
        <button type="button" className="btn btn-quiet" onClick={onClear}>
          Clear selection
        </button>
      </div>

      <h3 className="risk-level" style={{ color }}>
        Risk: {scored ? area.risk_level : "Unavailable"}
      </h3>

      <p className="risk-score">
        <strong>Risk Score: </strong>
        {scored ? `${area.risk_score.toFixed(1)} / 100` : "Unavailable"}
      </p>
      {scored && (
        <div className="score-bar" aria-hidden="true">
          <span style={{ width: `${area.risk_score}%`, background: color }} />
        </div>
      )}

      {state === "incomplete" && (
        <p role="status" className="callout">
          Some inputs are missing. This risk assessment is incomplete.
        </p>
      )}

      {state === "unavailable" && (
        <p role="status" className="callout">
          {area.processing_error
            ? "The risk score could not be calculated for this area. Try again later."
            : "Not enough input data to calculate a risk score for this area."}
        </p>
      )}

      <h3>Environmental Factors</h3>
      {area.observed_at && (
        <p className="muted small">Weather observed {formatDetectionTime(area.observed_at)}</p>
      )}
      <dl className="factors">
        {Object.entries(factorLabels).map(([key, label]) => (
          <div key={key} className="factor-row">
            <dt>{label}: </dt>
            <dd className={formatFactor(key, factors[key]) === "Unavailable" ? "muted" : undefined}>
              {formatFactor(key, factors[key])}
            </dd>
          </div>
        ))}
      </dl>

      {area.missing_inputs?.length > 0 && (
        <p>
          <strong>Missing inputs: </strong>
          {missingInputNames(area).join(", ")}
        </p>
      )}

      <p>
        <strong>Assessment complete: </strong>
        {area.is_complete ? "Yes" : "No"}
      </p>

      <details className="explain">
        <summary>
          <h3>How the risk estimate is calculated</h3>
        </summary>
        <p className="small">
          These factors contribute to a weighted risk estimate, not a confirmed wildfire detection.
          Higher factor scores mean higher modeled risk; missing factors are excluded and the
          remaining weights are normalized.
        </p>
        <ul aria-label="Risk factor explanations">
          {explainFactors(area).map(({ key, weight, score, explanation }) => (
            <li key={key}>
              <strong>{factorLabels[key]} ({Math.round(weight * 100)}% base weight): </strong>
              {score === null ? "Unavailable" : `${score.toFixed(1)} / 100`}. {explanation}
            </li>
          ))}
        </ul>
        <p className="small muted">
          Model: {area.model_version ?? "Unavailable"}. Factor scores and weights are provisional;
          this is not a validated real-time fire forecast.
        </p>
      </details>
    </aside>
  );
});

export default AreaDetails;
