// Supabase Auth REST client. Keep tokens in component memory only.
const base = String(import.meta.env?.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = String(import.meta.env?.VITE_SUPABASE_ANON_KEY || "");
export const staffAuthConfigured = base.startsWith("https://") && Boolean(key);

async function authRequest(path, options = {}) {
  if (!staffAuthConfigured) throw new Error("Staff sign-in is not configured.");
  let response;
  try {
    response = await fetch(`${base}/auth/v1/${path}`, {
      ...options,
      headers: { apikey: key, "Content-Type": "application/json", ...options.headers },
    });
  } catch {
    throw new Error("Could not connect to staff sign-in.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 400 || response.status === 401 ? "Invalid email, password, or session." : "Staff authentication unavailable.");
  return data;
}

export function signInStaff(email, password) {
  return authRequest("token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function refreshStaff(refreshToken) {
  return authRequest("token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) });
}

export function signOutStaff(accessToken) {
  return authRequest("logout", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
}
