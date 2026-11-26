// #48: representative, reproducible map data for performance checks.
// A small seeded random generator gives the same data on every run.

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// Spread over western and northern Canada, where the monitored areas are.
export function makeDetections(count, seed = 48) {
  const random = seeded(seed);
  return Array.from({ length: count }, (_, i) => {
    const confidence = Math.round(random() * 100);
    return {
      id: i + 1,
      latitude: Number((49 + random() * 13).toFixed(4)),
      longitude: Number((-125 + random() * 25).toFixed(4)),
      timestamp: new Date(Date.UTC(2026, 7, 1, 0, 0) + i * 60_000).toISOString(),
      confidence,
      classification: confidence >= 20 ? "potential_wildfire" : "low_confidence",
      meets_threshold: confidence >= 20,
    };
  });
}

export function makeAreas(count, seed = 12) {
  const random = seeded(seed);
  return Array.from({ length: count }, (_, i) => {
    const score = Math.round(random() * 1000) / 10;
    return {
      id: i + 1,
      name: `Area ${i + 1}`,
      latitude: 49 + i,
      longitude: -123 + i,
      risk_score: score,
      risk_level: score >= 70 ? "HIGH" : score >= 40 ? "MODERATE" : "LOW",
      is_complete: false,
      missing_inputs: ["vegetation_index"],
      coverage: 0.9,
      factor_scores: { temperature_c: 50, relative_humidity_pct: 60 },
      model_version: "weighted-index-v1",
      observed_at: "2026-08-01T18:00:00Z",
      environmental_factors: {
        temperature_c: 25, relative_humidity_pct: 30, wind_speed_kmh: 12,
        precipitation_mm: 0, vegetation_index: null, slope_deg: 8, nearby_detections: 40,
      },
    };
  });
}
