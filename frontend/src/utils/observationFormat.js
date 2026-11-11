// #49: wording for "when was this weather observed", so old data is never
// mistaken for current conditions. Times come from the API as ISO text.
import { formatDetectionTime } from "./detectionFormat.js";

const HOUR = 3600 * 1000;

function toDate(isoString) {
  if (typeof isoString !== "string" || isoString === "") return null;
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? null : date;
}

// "3 hours ago", "2 days ago". Future times (clock skew) read as "just now".
export function formatAge(date, now = Date.now()) {
  const hours = Math.floor((now - date.getTime()) / HOUR);
  if (hours < 1) return "less than an hour ago";
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

// One line for the details panel.
export function observationText(area, now = Date.now()) {
  const date = toDate(area?.observed_at);
  if (!date) return "No weather observation on record";
  return `${formatDetectionTime(area.observed_at)} (${formatAge(date, now)})`;
}

// The newest observation across all areas, or null if none can be read.
export function latestObservation(areas) {
  let latest = null;
  for (const area of areas ?? []) {
    const date = toDate(area?.observed_at);
    if (date && (!latest || date > latest.date)) latest = { date, iso: area.observed_at };
  }
  return latest;
}

export function lastUpdatedText(areas, now = Date.now()) {
  const latest = latestObservation(areas);
  if (!latest) return null;
  return `Weather data last updated: ${formatDetectionTime(latest.iso)} (${formatAge(latest.date, now)})`;
}
