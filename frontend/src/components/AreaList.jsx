import { riskColor, riskState, sortAreasByRisk } from "../utils/riskFormat";

function statusLabel(area) {
  const state = riskState(area);
  if (state === "unavailable") return "Unavailable";
  const level = area.risk_level.charAt(0) + area.risk_level.slice(1).toLowerCase();
  return `${level} · ${area.risk_score.toFixed(0)}${state === "incomplete" ? " · incomplete" : ""}`;
}

// Every monitored area as a tappable list, so areas can be chosen without
// hovering or hitting a small circle (phones, keyboard and screen readers).
export default function AreaList({ areas, selectedId, onSelect }) {
  if (areas.length === 0) return null;

  return (
    <nav aria-label="Monitored areas" className="area-list">
      <h2 className="area-list-title">Monitored areas</h2>
      <ul>
        {sortAreasByRisk(areas).map((area) => {
          const state = riskState(area);
          const color = riskColor(area);
          const name = area.name ?? `Area ${area.id}`;
          return (
            <li key={area.id}>
              <button
                type="button"
                className="area-chip"
                aria-pressed={selectedId === area.id}
                onClick={() => onSelect(area)}
              >
                <span
                  aria-hidden="true"
                  className="legend-dot"
                  style={{
                    background: state === "unavailable" ? "#e5e7eb" : color,
                    border: `2px ${state === "complete" ? "solid" : "dashed"} ${state === "unavailable" ? color : "#374151"}`,
                  }}
                />
                <span className="area-chip-text">
                  <span className="area-chip-name">{name}</span>
                  <span className="area-chip-status">{statusLabel(area)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
