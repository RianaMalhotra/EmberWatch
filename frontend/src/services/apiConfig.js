// Base URL of the Flask backend, shared by riskApi.js and detectionApi.js.
//
// Set VITE_API_BASE_URL at build/dev time to point at a deployed backend,
// e.g. in frontend/.env.local (see frontend/.env.example). When it is not
// set, the local Flask server is used, so local development needs no setup.
//
// `import.meta.env` only exists under Vite, so it is read defensively to keep
// the node:test unit tests working.
const DEFAULT_API_BASE_URL = "http://127.0.0.1:5000";

export function resolveApiBaseUrl(configured) {
  const value = typeof configured === "string" ? configured.trim() : "";
  // Drop trailing slashes so `${API_BASE_URL}/api/...` never has a double slash.
  return (value || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

export const API_BASE_URL = resolveApiBaseUrl(import.meta.env?.VITE_API_BASE_URL);
