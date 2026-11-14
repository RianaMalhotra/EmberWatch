import { useState } from "react";
import { moderatePublicReport, fetchReportAudit } from "../services/reportApi";

const STATUSES = ["confirmed", "rejected", "out_of_control", "being_held", "under_control", "out"];
export default function StaffModeration({ reports, onUpdated }) {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState({});
  const [audit, setAudit] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function update(report) {
    setBusy(true);
    setError("");
    try {
      await moderatePublicReport(report.id, status[report.id] || "confirmed", token);
      onUpdated?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function showAudit(id) {
    try {
      setError("");
      const rows = await fetchReportAudit(id, token);
      setAudit((prev) => ({ ...prev, [id]: rows }));
    } catch (err) { setError(err.message); }
  }
  return <section aria-label="Staff report moderation" style={{ padding: 16, background: "#f7f3fc", color: "#252033", borderRadius: 12 }}>
    <h2>Staff moderation</h2>
    <p>Authorized Supabase staff accounts only. Sign in with Supabase Auth and paste your current access token; the server verifies your identity and staff allowlist. Public reports are not confirmed satellite detections.</p>
    <label>Supabase staff access token <input aria-label="Supabase staff access token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    {reports.length === 0 && <p>No active public reports available.</p>}
    {reports.map((report) => <article key={report.id} style={{ borderTop: "1px solid #bbb", padding: 10 }}>
      <strong>Report #{report.id} — {report.review_status}</strong>
      <p>{report.sighting} · {report.latitude}, {report.longitude}</p>
      <label>New status <select aria-label={`Status for report ${report.id}`} value={status[report.id] || "confirmed"} onChange={(e) => setStatus((prev) => ({ ...prev, [report.id]: e.target.value }))}>
        {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
      </select></label>
      <button type="button" disabled={busy || !token} onClick={() => update(report)}>Save status</button>
      <button type="button" disabled={!token} onClick={() => showAudit(report.id)}>View audit history</button>
      {audit[report.id] && <ul>{audit[report.id].map((entry, i) => <li key={i}>{entry.old_status} → {entry.new_status} by {entry.staff_id} at {new Date(entry.changed_at).toLocaleString()}</li>)}</ul>}
    </article>)}
  </section>;
}
