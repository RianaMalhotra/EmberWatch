import { useEffect, useState } from "react";
import { moderatePublicReport, fetchReportAudit } from "../services/reportApi";
import { signInStaff, signOutStaff, refreshStaff, staffAuthConfigured } from "../services/staffAuth";

const STATUSES = ["confirmed", "rejected", "out_of_control", "being_held", "under_control", "out"];
export default function StaffModeration({ reports, onUpdated }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState({});
  const [audit, setAudit] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Refresh before expiry; never persist credentials or tokens in localStorage.
  useEffect(() => {
    if (!session?.refresh_token) return;
    const delay = Math.max(1000, (session.expires_at * 1000 || Date.now() + (session.expires_in || 3600) * 1000) - Date.now() - 60000);
    const timer = setTimeout(async () => {
      try { setSession(await refreshStaff(session.refresh_token)); }
      catch { setSession(null); setError("Staff session expired. Please sign in again."); }
    }, delay);
    return () => clearTimeout(timer);
  }, [session]);

  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = await signInStaff(email, password);
      if (!next.access_token || !next.refresh_token) throw new Error("Staff session was not returned.");
      setSession(next);
      setPassword("");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function logout() {
    const token = session?.access_token;
    setSession(null);
    setAudit({});
    setError("");
    if (token) {
      try { await signOutStaff(token); }
      catch { setError("Signed out locally; server sign-out could not be confirmed."); }
    }
  }
  async function withStaff(action) {
    setBusy(true);
    setError("");
    try {
      if (!session?.access_token) throw new Error("Please sign in first.");
      await action(session.access_token);
    } catch (err) {
      if (/\(401\)|\(403\)/.test(err.message)) setError("Access denied. Your account may not be authorized for moderation.");
      else setError(err.message);
    } finally { setBusy(false); }
  }
  return <section aria-label="Staff report moderation" style={{ padding: 16, background: "#f7f3fc", color: "#252033", borderRadius: 12 }}>
    <h2>Staff moderation</h2>
    <p>Only approved staff accounts can change report status. Public reports are not satellite detections.</p>
    {!staffAuthConfigured && <p role="alert">Staff sign-in is not configured. Set the public Supabase URL and anon key.</p>}
    {!session ? <form onSubmit={login}>
      <label>Staff email <input aria-label="Staff email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Password <input aria-label="Staff password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button type="submit" disabled={busy || !staffAuthConfigured}>Sign in</button>
    </form> : <>
      <p>Signed in as {session.user?.email || email} <button type="button" onClick={logout}>Sign out</button></p>
      {reports.length === 0 && <p>No active public reports available.</p>}
      {reports.map((report) => <article key={report.id} style={{ borderTop: "1px solid #bbb", padding: 10 }}>
        <strong>Report #{report.id} — {report.review_status}</strong>
        <p>{[report.observed_type, report.description].filter(Boolean).join(" — ")} · {report.latitude}, {report.longitude}</p>
        <label>New status <select aria-label={`Status for report ${report.id}`} value={status[report.id] || "confirmed"} onChange={(e) => setStatus((prev) => ({ ...prev, [report.id]: e.target.value }))}>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
        </select></label>
        <button type="button" disabled={busy} onClick={() => withStaff(async (token) => { await moderatePublicReport(report.id, status[report.id] || "confirmed", token); onUpdated?.(); })}>Save status</button>
        <button type="button" disabled={busy} onClick={() => withStaff(async (token) => { const rows = await fetchReportAudit(report.id, token); setAudit((prev) => ({ ...prev, [report.id]: rows })); })}>View audit history</button>
        {audit[report.id] && <ul>{audit[report.id].map((entry, i) => <li key={i}>{entry.old_status} → {entry.new_status} by {entry.staff_id} at {new Date(entry.changed_at).toLocaleString()}</li>)}</ul>}
      </article>)}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
