// Explain the existing weighted-index-v1 model without implying causal certainty.
// Keep these weights aligned with backend/services/risk_scoring.py.
export const FACTOR_WEIGHTS = {
  temperature_c: 0.15,
  relative_humidity_pct: 0.20,
  wind_speed_kmh: 0.15,
  precipitation_mm: 0.10,
  vegetation_index: 0.10,
  slope_deg: 0.05,
  nearby_detections: 0.25,
};

export const FACTOR_EXPLANATIONS = {
  temperature_c: "Higher temperatures increase the model's fire-risk contribution.",
  relative_humidity_pct: "Lower humidity increases the model's fire-risk contribution.",
  wind_speed_kmh: "Stronger winds increase the model's fire-risk contribution.",
  precipitation_mm: "Less recent rainfall increases the model's fire-risk contribution.",
  vegetation_index: "Higher vegetation index is treated as more potential fuel in this model.",
  slope_deg: "Steeper terrain increases the model's fire-risk contribution.",
  nearby_detections: "More nearby historical satellite detections increase the model's fire-risk contribution; they do not confirm an active fire.",
};

export function explainFactors(area) {
  const scores = area?.factor_scores ?? {};
  return Object.entries(FACTOR_WEIGHTS).map(([key, weight]) => ({
    key,
    weight,
    score: typeof scores[key] === "number" && Number.isFinite(scores[key]) ? scores[key] : null,
    explanation: FACTOR_EXPLANATIONS[key],
  }));
}
