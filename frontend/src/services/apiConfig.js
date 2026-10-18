// In development, use Vite's same-origin /api proxy to Flask.
// Production deployments may supply an absolute VITE_API_BASE_URL.
// A blank base URL produces /api/... paths and avoids Codespaces port auth/CORS.
export function resolveApiBaseUrl(configured) {
  const value = typeof configured === "string" ? configured.trim() : "";
  return value.replace(new RegExp("/+$"), "");
}

export const API_BASE_URL = resolveApiBaseUrl(import.meta.env?.VITE_API_BASE_URL);
