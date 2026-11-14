import { RISK_COLORS, UNAVAILABLE_COLOR } from "../utils/riskFormat";
import { detectionStyle } from "../utils/detectionFormat";

// #28 / #43: explains every kind of marker drawn on the map.
// Risk areas and satellite detections are listed separately so a detection
// is never mistaken for a risk level.
function Dot({ fill, stroke, dashed = false, size = 14 }) {
  return (
    <span
      aria-hidden="true"
      className="legend-dot"
      style={{
        width: size,
        height: size,
        background: fill ?? "transparent",
        border: `2px ${dashed ? "dashed" : "solid"} ${stroke ?? fill}`,
      }}
    />
  );
}

export default function RiskLegend() {
  const likely = detectionStyle({ classification: "potential_wildfire" });
  const low = detectionStyle({ classification: "low_confidence" });

  return (
    <div aria-label="Map legend" className="legend">
      <div className="legend-group">
        <span className="legend-title">Risk areas</span>
        <span className="legend-item"><Dot fill={RISK_COLORS.HIGH} />High</span>
        <span className="legend-item"><Dot fill={RISK_COLORS.MODERATE} />Moderate</span>
        <span className="legend-item"><Dot fill={RISK_COLORS.LOW} />Low</span>
        <span className="legend-item"><Dot stroke="#374151" dashed />Dashed outline: incomplete (some inputs missing)</span>
        <span className="legend-item"><Dot fill="#e5e7eb" stroke={UNAVAILABLE_COLOR} dashed />Grey: risk unavailable (not enough data)</span>
      </div>
      <div className="legend-group">
        <span className="legend-title">Satellite detections</span>
        <span className="legend-item"><Dot fill={likely.fillColor} stroke={likely.color} size={10} />Potential wildfire</span>
        <span className="legend-item"><Dot fill={low.fillColor} stroke={low.color} dashed size={10} />Low confidence</span>
      </div>
    </div>
  );
}
