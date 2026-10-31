// #51: rules for the public "Report a Fire" form (ported from the PRA4 prototype v2).
// Kept out of the component so they can be unit tested without a browser.

export const SIGHTINGS = ["Flames", "Smoke", "Both"];
export const MAX_DESCRIPTION = 500;

// Time entry from prototype v2: accepts 12-hour + AM/PM, or 24-hour.
// Hours 13–23 and 0 set AM/PM automatically, so "17:26" needs no AM/PM.
export function parseReportTime(hh, mm, ap) {
  if (hh === "" || mm === "") return { ok: false, msg: "" };
  const h = Number.parseInt(hh, 10);
  const m = Number.parseInt(mm, 10);
  if (Number.isNaN(h) || h < 0 || h > 23) return { ok: false, msg: "Hour must be 0–23" };
  if (Number.isNaN(m) || m < 0 || m > 59 || mm.length < 2) {
    return { ok: false, msg: "Minutes must be 00–59" };
  }
  const minutes = String(m).padStart(2, "0");
  if (h >= 13) return { ok: true, auto: "PM", hour24: h, minute: m, text: `${h - 12}:${minutes} PM` };
  if (h === 0) return { ok: true, auto: "AM", hour24: 0, minute: m, text: `12:${minutes} AM` };
  if (!ap) return { ok: false, msg: "Choose AM or PM" };
  const hour24 = ap === "PM" ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h);
  return { ok: true, hour24, minute: m, text: `${h}:${minutes} ${ap}` };
}

// The moment the fire was seen, as a UTC ISO string (stored in UTC, shown in local time).
// "earlier" uses today's local date; a time later than now is rejected.
export function observedAtUtc(when, time, now = new Date()) {
  if (when === "now") return { ok: true, iso: now.toISOString() };
  if (!time?.ok) return { ok: false, msg: time?.msg || "Enter the time you saw it" };
  const seen = new Date(now);
  seen.setHours(time.hour24, time.minute, 0, 0);
  if (seen > now) return { ok: false, msg: "That time hasn't happened yet today" };
  return { ok: true, iso: seen.toISOString() };
}

export function validLocation(pin) {
  return Boolean(pin)
    && Number.isFinite(pin.latitude) && pin.latitude >= -90 && pin.latitude <= 90
    && Number.isFinite(pin.longitude) && pin.longitude >= -180 && pin.longitude <= 180;
}

// Every problem that blocks submission, in plain words. Empty list = ready to submit.
export function reportProblems({ pin, saw, when, time, description }, now = new Date()) {
  const problems = [];
  if (!validLocation(pin)) problems.push("Mark where the fire is.");
  if (!SIGHTINGS.includes(saw)) problems.push("Choose flames, smoke or both.");
  const seen = observedAtUtc(when, time, now);
  if (!seen.ok) problems.push(seen.msg);
  if ((description ?? "").length > MAX_DESCRIPTION) {
    problems.push(`Details must be ${MAX_DESCRIPTION} characters or fewer.`);
  }
  return problems;
}

// What the backend receives (#52 stores it with provenance and status "unverified").
export function buildReportPayload({ pin, saw, when, time, description }, now = new Date()) {
  const trimmed = (description ?? "").trim();
  return {
    latitude: Number(pin.latitude.toFixed(5)),
    longitude: Number(pin.longitude.toFixed(5)),
    location_source: pin.source === "gps" ? "gps" : "map",
    observed_type: saw.toLowerCase(),
    observed_at: observedAtUtc(when, time, now).iso,
    description: trimmed === "" ? null : trimmed,
  };
}

export function formatPin(pin) {
  if (!validLocation(pin)) return "";
  const label = pin.source === "gps" ? "Your current location" : "Point on map";
  const ns = pin.latitude >= 0 ? "N" : "S";
  const ew = pin.longitude >= 0 ? "E" : "W";
  return `${label} (${Math.abs(pin.latitude).toFixed(4)}° ${ns}, ${Math.abs(pin.longitude).toFixed(4)}° ${ew})`;
}
