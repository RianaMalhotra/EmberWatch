// How old is the data on the map? Shown above the map so old data is never
// mistaken for live conditions (requirements: Reliability, Safety guardrails).

const DAY_MS = 24 * 60 * 60 * 1000;

// Weather is refreshed daily with yesterday's noon values, so on a normal day
// the newest observation is 1-2 days old. Older than this means the refresh
// stopped.
export const WEATHER_STALE_DAYS = 3;

// Detections newer than this count as recent; anything older is history.
export const DETECTIONS_RECENT_DAYS = 3;

function toTime(value) {
  // new Date(null) is 1970-01-01, so a missing value must be checked first.
  if (value === null || value === undefined || value === "") return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function formatDay(time, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(time));
}

function ageInDays(time, now) {
  return Math.floor((now.getTime() - time) / DAY_MS);
}

// Newest weather observation across the areas, or null if none have one.
export function weatherFreshness(areas, now = new Date(), timeZone) {
  const times = (areas ?? []).map((a) => toTime(a?.observed_at)).filter((t) => t !== null);
  if (times.length === 0) return null;

  const latest = Math.max(...times);
  const days = ageInDays(latest, now);
  const stale = days >= WEATHER_STALE_DAYS;
  return {
    latest,
    days,
    stale,
    text: stale
      ? `Weather data is ${days} days old (last observed ${formatDay(latest, timeZone)}). Risk levels may not reflect current conditions.`
      : `Weather data as of ${formatDay(latest, timeZone)}.`,
  };
}

// Date range of the detections on the map, and whether they are historical.
export function detectionPeriod(detections, now = new Date(), timeZone) {
  const times = (detections ?? []).map((d) => toTime(d?.timestamp)).filter((t) => t !== null);
  if (times.length === 0) return null;

  const first = Math.min(...times);
  const last = Math.max(...times);
  const historical = ageInDays(last, now) >= DETECTIONS_RECENT_DAYS;
  const firstDay = formatDay(first, timeZone);
  const lastDay = formatDay(last, timeZone);
  const range = firstDay === lastDay ? firstDay : `${firstDay} – ${lastDay}`;
  return {
    first,
    last,
    historical,
    text: historical
      ? `Satellite detections shown are from ${range}: historical records, not current fires.`
      : `Satellite detections shown are from ${range}.`,
  };
}
