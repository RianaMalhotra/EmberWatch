import { API_BASE_URL } from "./apiConfig.js";
import { sanitizeDetections } from "../utils/detectionFormat.js";

// #18: loads classified detections (#17) from Flask. Same style as riskApi.js.
export async function fetchDetections(limit = 200) {
  const response = await fetch(
    `${API_BASE_URL}/api/detections?limit=${encodeURIComponent(limit)}`
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch detections: ${response.status}`
    );
  }

  const result = await response.json();

  if (!Array.isArray(result.detections)) {
    throw new Error("Invalid detection data received");
  }

  return sanitizeDetections(result);
}
