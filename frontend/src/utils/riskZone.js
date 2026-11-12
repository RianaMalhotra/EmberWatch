// #44: heat-style "risk zone" overlay for the Leaflet map.
//
// Each monitored area gets one translucent circle whose fill strength follows
// that area's own risk score. Zones are NOT interpolated between areas: where
// there is no score there is no fill, so the overlay never shows risk for a
// place the model did not actually score (#27, #28).
import { riskState, riskColor, UNAVAILABLE_COLOR } from "./riskFormat";

// The model counts past fire detections within this radius of an area
// (HISTORY_RADIUS_KM in backend/services/risk_scoring.py), so the zone draws
// the same footprint. Keep the two values in sync.
export const RISK_ZONE_RADIUS_M = 50_000;

export const ZONE_MIN_FILL = 0.1; // score 0
export const ZONE_MAX_FILL = 0.5; // score 100

// Leaflet path options for an area's zone.
//  - complete:    solid outline, fill strength follows risk_score
//  - incomplete:  same fill, dashed outline (some inputs missing)
//  - unavailable: no fill at all, faint grey dashed outline
export function riskZoneStyle(area) {
  const state = riskState(area);

  if (state === "unavailable") {
    return {
      color: UNAVAILABLE_COLOR,
      fillColor: UNAVAILABLE_COLOR,
      fillOpacity: 0,
      opacity: 0.5,
      weight: 1,
      dashArray: "4 6",
    };
  }

  const score = area.risk_score; // validated by riskState: 0-100 and a known level
  return {
    color: riskColor(area),
    fillColor: riskColor(area),
    fillOpacity: ZONE_MIN_FILL + (ZONE_MAX_FILL - ZONE_MIN_FILL) * (score / 100),
    opacity: 0.8,
    weight: 1,
    dashArray: state === "complete" ? null : "8 6",
  };
}
