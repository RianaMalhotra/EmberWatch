// #28: wording and styling helpers for risk areas, so an incomplete or
// unscored assessment never looks the same as a complete one.
// Kept out of App.jsx so they can be unit tested without a browser.

export const RISK_COLORS = {
  HIGH: "#dc2626",
  MODERATE: "#f97316",
  LOW: "#16a34a",
};
export const UNAVAILABLE_COLOR = "#6b7280";

export const FACTOR_LABELS = {
  temperature_c: "Temperature",
  relative_humidity_pct: "Relative Humidity",
  wind_speed_kmh: "Wind Speed",
  precipitation_mm: "Precipitation",
  vegetation_index: "Vegetation Index",
  slope_deg: "Slope",
  nearby_detections: "Nearby Fire Detections",
};

// Three states, each drawn differently on the map.
export function validRiskScore(area) {
  return typeof area?.risk_score === "number"
    && Number.isFinite(area.risk_score)
    && area.risk_score >= 0
    && area.risk_score <= 100
    && ["LOW", "MODERATE", "HIGH"].includes(area.risk_level);
}

export function riskState(area) {
  if (!validRiskScore(area)) return "unavailable"; // too few inputs to score at all
  if (area.is_complete === false) return "incomplete"; // scored, but some inputs missing
  return "complete";
}

export function riskColor(area) {
  return validRiskScore(area) ? RISK_COLORS[area.risk_level] : UNAVAILABLE_COLOR;
}

// Leaflet path options. Dashed outline = incomplete; grey = no score.
export function riskAreaStyle(area, selected = false) {
  const state = riskState(area);
  const color = riskColor(area);
  return {
    color,
    fillColor: color,
    fillOpacity: state === "unavailable" ? 0.15 : selected ? 0.8 : 0.5,
    weight: selected ? 4 : 2,
    dashArray: state === "complete" ? null : "8 6",
    radius: selected ? 16 : 13,
  };
}

export function missingInputNames(area) {
  return (area?.missing_inputs ?? []).map((key) => FACTOR_LABELS[key] ?? key);
}

// Short text for screen readers, tooltips and the details panel.
export function riskStatusText(area) {
  const state = riskState(area);
  if (state === "unavailable") {
    return "Risk unavailable: not enough input data to calculate a score.";
  }
  if (state === "incomplete") {
    const missing = missingInputNames(area);
    return `${area.risk_level} risk (incomplete${missing.length ? `: missing ${missing.join(", ")}` : ""}).`;
  }
  return `${area.risk_level} risk (all inputs available).`;
}

// [lat, lon] pairs of areas with valid coordinates, for fitting the map view.
export function areaBounds(areas) {
  return (areas ?? [])
    .filter((a) => Number.isFinite(a.latitude) && Number.isFinite(a.longitude))
    .map((a) => [a.latitude, a.longitude]);
}
