
import { API_BASE_URL } from "./apiConfig.js";
import { readJson, withTimeout } from "./requestHelpers.js";

export async function fetchRiskAreas() {
  const response = await withTimeout(
    fetch(`${API_BASE_URL}/api/risk-areas`)
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch risk data: ${response.status}`
    );
  }

  const result = await readJson(response, "Invalid risk data received");

  if (!Array.isArray(result?.data)) {
    throw new Error("Invalid risk data received");
  }

  return result;
}
