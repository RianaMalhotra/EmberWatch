import { API_BASE_URL } from "./apiConfig.js";

// #51 → #52: sends a public fire report to Flask. Same style as riskApi.js.

// The form only submits when VITE_ENABLE_REPORTS=true. Until POST /api/reports
// (#52) is merged, it stays a preview so it is never presented as working.
export function reportsEnabled(flag = import.meta.env?.VITE_ENABLE_REPORTS) {
  return String(flag ?? "").trim().toLowerCase() === "true";
}

export const REPORTS_ENABLED = reportsEnabled();

// Expected #52 success response (see docs/component-interfaces.md):
//   201 { "status": "success", "data": { "id": 42, "review_status": "unverified" } }
// Anything else is treated as a failed save, so the user is never told a
// report was received when we can't confirm it was stored.
export function parseReportResponse(body) {
  const data = body?.data;
  const valid = body?.status === "success"
    && Number.isInteger(data?.id) && data.id > 0
    && data?.review_status === "unverified";
  if (!valid) {
    throw new Error("The server's reply could not be confirmed, so the report may not have been saved. Please try again.");
  }
  return { id: data.id, reviewStatus: data.review_status };
}

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

  const body = await response.json().catch(() => null);
  return parseReportResponse(body);
}
