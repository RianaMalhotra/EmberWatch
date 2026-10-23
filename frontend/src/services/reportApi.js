import { API_BASE_URL } from "./apiConfig.js";

// #51 → #52: sends a public fire report to Flask. Same style as riskApi.js.
// The endpoint (POST /api/reports) is built in #52; until then this fails
// with a clear message and the form keeps the user's answers.
export async function submitReport(payload) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }

  if (!response.ok) {
    throw new Error(`The report could not be saved (error ${response.status}). Please try again.`);
  }

  const result = await response.json().catch(() => ({}));
  return { id: result.id ?? null, status: result.status ?? "unverified" };
}
