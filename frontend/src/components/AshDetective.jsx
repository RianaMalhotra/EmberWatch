import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../services/apiConfig";
import AshMascot from "./AshMascot";

const starterQuestions = ["What's the risk in Kelowna?", "What do fire icons mean?", "How current is the data?"];

function localAnswer(question, areas, detections) {
  const q = question.toLowerCase();
  const area = areas.find((a) => a.name && q.includes(a.name.toLowerCase()));
  if (area) {
    const score = typeof area.risk_score === "number" && Number.isFinite(area.risk_score)
      ? `${area.risk_level ?? "Unclassified"} (${area.risk_score.toFixed(1)}/100)`
      : "unavailable";
    return `Case file: ${area.name}. The loaded environmental risk assessment is ${score}. Weather observed: ${area.observed_at ? new Date(area.observed_at).toLocaleString() : "date unavailable"}. ${area.is_complete ? "The modeled inputs are marked complete." : "Some inputs are missing; interpret cautiously."} This is a provisional assessment, not a live fire alert.`;
  }
  if (/high|moderate|low|score|risk level|colour|color|circle/.test(q))
    return "Risk circles show modeled environmental risk: LOW below 40, MODERATE from 40 to under 70, and HIGH from 70 to 100. A red fire hotspot is a separate satellite observation; it does not automatically mean HIGH environmental risk. Scores only exist for monitored areas.";
  if (/fire|flame|hotspot|detect|satellite|confidence/.test(q))
    return `Flame icons show satellite hotspots, not confirmed wildfires. Bright flames meet the confidence threshold; faded flames are lower-confidence observations. The currently loaded map has ${detections.length} detection records. Click a flame to inspect its timestamp, coordinates and confidence. These records may be historical.`;
  if (/current|fresh|today|now|live|date|recent|updated/.test(q))
    return "EmberWatch is an educational prototype, not a live emergency service. Risk assessments and satellite records may be old. Open Explore map and review the Data freshness notice for the exact available timestamps. For current conditions or evacuation orders, use official provincial wildfire services.";
  if (/search|canada|area|city|location|place|map/.test(q))
    return "Explore map lets you search Canadian cities and towns with autocomplete. Monitored areas have modeled risk scores; other locations can be located on the map but do not receive invented risk scores. The loaded satellite records are limited and do not prove whether a fire is currently present.";
  if (/report|emergency|evacuat|safe|911/.test(q))
    return "For an active emergency, call local emergency services and follow official evacuation instructions. EmberWatch's Report a fire feature is not an emergency dispatch channel.";
  return "I can investigate monitored-area risk scores, fire icons, detection confidence, search, reports, and data freshness. Try asking about a monitored city, or open Explore map to select a place. I won't invent a current fire status or a risk score for an unmonitored location.";
}

export default function AshDetective({ areas = [], detections = [], selectedArea, searchedPlace }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([{ role: "assistant", text: "Ash Detective, on the case. 🕵️ Ask about a place, a fire marker, or how EmberWatch works." }]);
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { if (open) endRef.current?.scrollIntoView?.({ block: "end" }); }, [messages, open]);
  async function ask(raw) {
    const question = raw.trim().slice(0, 500);
    if (!question || busy) return;
    setDraft("");
    setMessages((old) => [...old, { role: "user", text: question }]);
    setBusy(true);
    let answer = "";
    try {
      const response = await fetch(`${API_BASE_URL}/api/ash-detective`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, context: {
          selected_area: selectedArea?.name ?? null,
          searched_place: searchedPlace?.name ?? null,
          areas: areas.slice(0, 100).map((a) => ({ name: a.name, risk_score: a.risk_score, risk_level: a.risk_level, observed_at: a.observed_at, is_complete: a.is_complete })),
          detection_count: detections.length
        } }),
      });
      if (response.ok) {
        const data = await response.json();
        if (typeof data.answer === "string" && data.answer.trim()) answer = data.answer;
      }
    } catch { /* An optional AI service may be offline; use transparent local guidance. */ }
    if (!answer) answer = localAnswer(question, areas, detections);
    setMessages((old) => [...old, { role: "assistant", text: answer }]);
    setBusy(false);
  }
  return (
    <div className="ash-shell">
      {open && <section className="ash-panel" aria-label="Ash Detective assistant">
        <header className="ash-head"><div className="ash-avatar"><AshMascot size={38} /></div><div><strong>Ash Detective</strong><span>Wildfire case notes · educational</span></div><button type="button" aria-label="Close Ash Detective" onClick={() => setOpen(false)}>×</button></header>
        <div className="ash-messages" role="log" aria-live="polite">{messages.map((m, i) => <div className={`ash-message ash-${m.role}`} key={i}>{m.text}</div>)}{busy && <div className="ash-message ash-assistant">Investigating…</div>}<div ref={endRef} /></div>
        {messages.length === 1 && <div className="ash-suggestions">{starterQuestions.map((q) => <button type="button" key={q} onClick={() => ask(q)}>{q}</button>)}</div>}
        <form className="ash-compose" onSubmit={(e) => { e.preventDefault(); ask(draft); }}><input aria-label="Ask Ash Detective" placeholder="Ask me anything about the map…" value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)} /><button type="submit" disabled={!draft.trim() || busy} aria-label="Send message">➤</button></form>
        <p className="ash-caution">May be incomplete or outdated · Not emergency advice</p>
      </section>}
      <button type="button" className="ash-launcher" aria-label={open ? "Close Ash Detective" : "Chat with Ash Detective"} aria-expanded={open} onClick={() => setOpen((v) => !v)}><span aria-hidden="true"><AshMascot size={29} /></span><span>{open ? "Close case" : "Ask Ash"}</span></button>
    </div>
  );
}
