// #18: wording and styling helpers for detection markers.
// Kept out of App.jsx so they can be unit tested without a browser.

export const LOW_CONFIDENCE = "low_confidence";

// Timestamps are stored in UTC and shown in the viewer's local time with the
// zone labelled (docs/requirements.md, Data Sources and Provenance).
export function formatDetectionTime(isoString, timeZone) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "Time unavailable";

  return new Intl.DateTimeFormat("en-CA", {
    // dateStyle/timeStyle can't be combined with timeZoneName, so spell out the fields.
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function formatCoordinates(latitude, longitude) {
  return `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
}

export function formatConfidence(confidence) {
  return typeof confidence === "number" ? `${Math.round(confidence)}%` : "Unavailable";
}

// Low-confidence detections must look different from the rest, not identical.
export function detectionStyle(detection) {
  if (detection.classification === LOW_CONFIDENCE) {
    return { color: "#6b7280", fillColor: "#9ca3af", fillOpacity: 0.25, dashArray: "3 3", radius: 5 };
  }
  return { color: "#b91c1c", fillColor: "#ef4444", fillOpacity: 0.85, dashArray: null, radius: 7 };
}

export function classificationLabel(detection) {
  return detection.classification === LOW_CONFIDENCE
    ? "Low confidence detection"
    : "Potential wildfire";
}

// One line for the status banner, including rows that could not be shown.
export function detectionSummary(result) {
  const counts = result.counts || {};
  const shown = counts.shown ?? result.detections.length;
  const likely = counts.potential_wildfire ?? 0;
  const low = counts.low_confidence ?? 0;
  const unavailable = counts.unavailable ?? 0;

  let text = `${shown} ${shown === 1 ? "detection" : "detections"} shown: ${likely} potential wildfire, ${low} low confidence (threshold ${result.threshold}%).`;
  if (unavailable > 0) {
    text += ` ${unavailable} could not be shown because their data is missing or invalid.`;
  }
  return text;
}

// A detection can only be drawn if its location and confidence are real, finite
// numbers. Leaflet throws on a NaN position, which would blank the whole map.
export function isDisplayableDetection(detection) {
  return (
    detection !== null &&
    typeof detection === "object" &&
    Number.isFinite(detection.latitude) &&
    Number.isFinite(detection.longitude) &&
    Math.abs(detection.latitude) <= 90 &&
    Math.abs(detection.longitude) <= 180 &&
    Number.isFinite(detection.confidence) &&
    detection.confidence >= 0 &&
    detection.confidence <= 100
  );
}

// Second line of defence after the backend's validation: drop anything that is
// not displayable and count it as unavailable instead of showing it.
export function sanitizeDetections(result) {
  const detections = result.detections.filter(isDisplayableDetection);
  const dropped = result.detections.length - detections.length;
  if (dropped === 0) return result;

  const counts = result.counts || {};
  const likely = detections.filter((d) => d.classification !== LOW_CONFIDENCE).length;
  return {
    ...result,
    detections,
    counts: {
      ...counts,
      total: counts.total ?? result.detections.length,
      shown: detections.length,
      potential_wildfire: likely,
      low_confidence: detections.length - likely,
      unavailable: (counts.unavailable ?? 0) + dropped,
    },
  };
}
