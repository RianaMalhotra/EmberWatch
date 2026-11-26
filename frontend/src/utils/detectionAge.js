// #48 usability: participants could not tell fires happening now from old
// satellite records, and asked for a button to switch between them.

export const RECENT_HOURS = 24;

export const DETECTION_AGE_OPTIONS = [
  ["all", "All"],
  ["recent", `Last ${RECENT_HOURS} h`],
  ["historical", "Historical"],
];

// A detection is recent if it was seen within RECENT_HOURS before `now`.
// Detections without a valid timestamp are never called recent.
export function isRecent(detection, now = Date.now(), hours = RECENT_HOURS) {
  const time = Date.parse(detection?.timestamp ?? "");
  if (!Number.isFinite(time)) return false;
  return time <= now && now - time <= hours * 3600 * 1000;
}

export function filterDetectionsByAge(detections, mode, now = Date.now(), hours = RECENT_HOURS) {
  const list = Array.isArray(detections) ? detections : [];
  if (mode === "recent") return list.filter((d) => isRecent(d, now, hours));
  if (mode === "historical") return list.filter((d) => !isRecent(d, now, hours));
  return list;
}
