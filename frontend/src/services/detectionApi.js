import { API_BASE_URL } from "./apiConfig.js";
import { sanitizeDetections } from "../utils/detectionFormat.js";
import { readJson, withTimeout } from "./requestHelpers.js";

// #18: loads classified detections (#17) from Flask. Same style as riskApi.js.
export async function fetchDetections(limit = 200) {
  const response = await withTimeout(
    fetch(`${API_BASE_URL}/api/detections?limit=${encodeURIComponent(limit)}`)
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch detections: ${response.status}`
    );
  }

  const result = await readJson(response, "Invalid detection data received");

  if (!Array.isArray(result?.detections)) {
    throw new Error("Invalid detection data received");
  }

  return sanitizeDetections(result);
}

/**
 * Fetch archived detections within a WGS84 bounding box and UTC time window.
 * Requires the /api/detections/history endpoint from Sprint 3 PR #84.
 * Dates must include a timezone; the end instant is exclusive.
 */
export async function fetchDetectionHistory({ south, north, west, east, start, end, limit = 200 }) {
  const bounds = [south, north, west, east];
  if (!bounds.every((value) => typeof value === "number" && Number.isFinite(value))
      || south < -90 || north > 90 || south > north
      || west < -180 || east > 180 || west > east) {
    throw new Error("Invalid historical detection region");
  }
  const parseInstant = (value) => {
    if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/i.test(value)) {
      throw new Error("History dates must include a timezone");
    }
    const instant = Date.parse(value);
    if (!Number.isFinite(instant)) throw new Error("Invalid history date");
    return instant;
  };
  const from = parseInstant(start);
  const to = parseInstant(end);
  if (from >= to) throw new Error("History start must be earlier than end");
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("History limit must be between 1 and 1000");
  }

  const params = new URLSearchParams({
    south: String(south), north: String(north), west: String(west), east: String(east),
    start: new Date(from).toISOString(), end: new Date(to).toISOString(), limit: String(limit),
  });
  const response = await fetch(`${API_BASE_URL}/api/detections/history?${params}`);
  if (!response.ok) throw new Error(`Failed to fetch detection history: ${response.status}`);
  const result = await response.json();
  if (!Array.isArray(result?.detections)) throw new Error("Invalid historical detection data received");
  return sanitizeDetections(result);
}
