import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../services/apiConfig";
import AshMascot from "./AshMascot";
import { summarizeDay, level } from "../utils/weatherClassifier";

const starterQuestions = ["What is the four-day forecast?", "How does tomorrow compare?", "What's the risk in Kelowna?", "How current is the data?"];
const welcome = { role: "assistant", text: "Ash Detective, on the case. 🕵️ Ask about EmberWatch, its stakeholders, how to use the website, monitored areas, or the weather outlook." };
const forecastQuestion = (q) => /forecast|outlook|tomorrow|next (?:few |four |4 )?days|weather pattern|similarity|temperature|humidity|precipitation|wind/.test(q.toLowerCase());
async function loadForecast(area) {
  const query = new URLSearchParams({ latitude: String(area.latitude), longitude: String(area.longitude), hourly: "temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation", forecast_days: "4", timezone: "auto" });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`);
  if (!response.ok) throw new Error("Forecast service unavailable");
  const data = await response.json();
  if (!Array.isArray(data?.hourly?.time)) throw new Error("Incomplete forecast data");
  const dates = [...new Set(data.hourly.time.map(t => t.slice(0, 10)))].slice(0, 4);
  const days = dates.map(date => summarizeDay(data.hourly, date));
  if (days.length !== 4 || days.some(d => !d)) throw new Error("Forecast inputs incomplete");
  return { area: area.name, days: days.map(({ date, average, temperature, humidity, wind, precipitation }) => ({ date, similarity: average, temperature_c: temperature, humidity_pct: humidity, wind_kmh: wind, precipitation_mm: precipitation })), retrieved_at: new Date().toISOString() };
}

function projectGuide(question) {
  const q = question.toLowerCase();
  if (/stakeholder|who (?:is|are) (?:this|the) (?:project|website) for|who uses (?:emberwatch|this)/.test(q))
    return "EmberWatch stakeholders include: (1) local residents and communities who want wildfire awareness; (2) emergency responders and wildfire-management agencies who could use supplementary observations; (3) researchers and environmental scientists studying satellite detections and environmental conditions; (4) community contributors and staff moderators who submit and review reports; and (5) the student development team, university evaluators, data providers such as NASA FIRMS, and hosting providers. Emergency agencies and researchers are intended or potential users, not confirmed project partners. EmberWatch is not an official emergency service.";
  if (/how (?:do|can|to|should) (?:i|we|you) (?:use|navigate)|instructions|tutorial|walk.?through|getting started|website guide|how (?:does|to) (?:the )?(?:site|website) work/.test(q))
    return "How to use EmberWatch:\n1. Open Overview for the project summary and current monitored-area information.\n2. Open Explore to search for a city, inspect monitored-area risk circles, and click satellite flame markers to view timestamps and confidence. Search results outside monitored areas may not have risk scores.\n3. Open Forecast for a four-day weather comparison; similarity scores are NOT fire probabilities.\n4. Open Learn to understand wildfire risk and data limitations.\n5. Open More → Advanced analytics for the Operations dashboard (area prioritization, satellite observations, staff-verified community reports when available, CSV/GeoJSON export) or Research lab (DBSCAN clustering and environmental plots).\n6. Use Report a fire to submit an observation if available; it is not an emergency dispatch channel.\n7. Ask Ash about a location, hotspot, or data freshness. Always check observation timestamps and follow official wildfire authorities for emergencies.";
  if (/tell me about (?:this|the) (?:project|website|app)|what is emberwatch|about emberwatch|project overview|what does emberwatch do|purpose of (?:this|the) (?:project|website)/.test(q))
    return "EmberWatch is a University of Toronto ECE444 educational wildfire early-detection and risk-monitoring web project. It brings together NASA FIRMS satellite thermal observations, modeled environmental risk for monitored areas, four-day weather outlooks, and community fire reports. Explore provides an interactive map; Forecast shows weather-pattern similarity (not fire probability); Learn explains risk; and Advanced analytics offers Operations and Research views with filters, clustering, and exports. Staff can review community reports, while the public dashboard only shows verified reports when the service is available. Satellite hotspots are not confirmed wildfires, and EmberWatch is not a real-time emergency alert or evacuation system.";
  return null;
}

function localAnswer(question, areas, detections, rememberedArea = null) {
  const q = question.toLowerCase();
  const guide = projectGuide(question);
  if (guide) return guide;
  const area = areas.find((a) => a.name && q.includes(a.name.toLowerCase())) ?? (/\b(it|its|there|that area|this area|same area|the risk|its data)\b/.test(q) ? rememberedArea : null);
  if (area) {
    const score = typeof area.risk_score === "number" && Number.isFinite(area.risk_score)
      ? `${area.risk_level ?? "Unclassified"} (${area.risk_score.toFixed(1)}/100)`
      : "unavailable";
    return `Case file: ${area.name}. The loaded environmental risk assessment is ${score}. Weather observed: ${area.observed_at ? new Date(area.observed_at).toLocaleString() : "date unavailable"}. ${area.is_complete ? "The modeled inputs are marked complete." : "Some inputs are missing; interpret cautiously."} This is a provisional assessment, not a live fire alert.`;
  }
  if (forecastQuestion(q)) return "The AI Forecast page compares four days of forecast weather with a small historical fire-day dataset. Its similarity scores are not wildfire probabilities or emergency predictions. Open AI Forecast for the latest available readings.";
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

export default function AshDetective({ areas = [], detections = [], selectedArea, searchedPlace, currentPage = "home" }) {
  const contextualQuestions = currentPage === "forecast" ? ["Explain the four-day weather outlook", "What does similarity mean?", "How does tomorrow compare?"] : currentPage === "lab" ? ["How does the what-if simulator work?", "Why is confidence different from risk?", "Are these records current?"] : selectedArea ? ["Explain the risk for " + selectedArea.name, "How current is this area data?", "What do the factor scores mean?"] : starterQuestions;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([welcome]);
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const historyRef = useRef([]);
  const lastAreaRef = useRef(null);
  const conversationVersionRef = useRef(0);
  const [forecastCache, setForecastCache] = useState(null);
  function clearChat() { conversationVersionRef.current += 1; lastAreaRef.current = null; historyRef.current = []; setMessages([welcome]); setForecastCache(null); setDraft(""); setBusy(false); }
  useEffect(() => { if (open) endRef.current?.scrollIntoView?.({ block: "end" }); }, [messages, open]);
  useEffect(() => {
    const onLogout = () => clearChat();
    window.addEventListener("emberwatch:logout", onLogout);
    return () => window.removeEventListener("emberwatch:logout", onLogout);
  }, []);
  async function ask(raw) {
    const question = raw.trim().slice(0, 500);
    const conversationVersion = conversationVersionRef.current;
    if (!question || busy) return;
    setDraft("");
    const prior = historyRef.current.slice(-12);
    const mentionedArea = areas.find((a) => a.name && question.toLowerCase().includes(a.name.toLowerCase()));
    const contextualArea = mentionedArea ?? selectedArea ?? lastAreaRef.current;
    if (contextualArea) lastAreaRef.current = contextualArea;
    setMessages((old) => [...old, { role: "user", text: question }]);
    setBusy(true);
    let answer = projectGuide(question) ?? "";
    if (answer) { historyRef.current = [...prior, { role: "user", content: question }, { role: "assistant", content: answer }].slice(-12); setMessages(old => [...old, { role: "assistant", text: answer }]); setBusy(false); return; }
    let forecast = null;
    let forecastError = "";
    if (forecastQuestion(question)) {
      const previousArea = forecastCache && areas.find(a => a.name === forecastCache.area);
      const mentioned = areas.find(a => a.name && question.toLowerCase().includes(a.name.toLowerCase()));
      const target = mentioned ?? contextualArea ?? previousArea ?? areas.find(a => Number.isFinite(a.latitude) && Number.isFinite(a.longitude));
      if (target && Number.isFinite(target.latitude) && Number.isFinite(target.longitude)) {
        try { forecast = await loadForecast(target); if (conversationVersion === conversationVersionRef.current) setForecastCache(forecast); }
        catch { forecastError = "Forecast data is currently unavailable."; }
      } else forecastError = "No monitored area is available for a forecast.";
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/ash-detective`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history: prior, context: {
          forecast, forecast_error: forecastError,
          selected_area: contextualArea?.name ?? null,
          current_page: currentPage,
          searched_place: searchedPlace?.name ?? null,
          areas: areas.slice(0, 100).map((a) => ({ name: a.name, risk_score: a.risk_score, risk_level: a.risk_level, observed_at: a.observed_at, is_complete: a.is_complete })),
          detection_count: detections.length,
          detections: detections.slice(0, 20).map((d) => ({
            latitude: d.latitude, longitude: d.longitude, confidence: d.confidence,
            classification: d.classification, timestamp: d.timestamp ?? d.acquired_at ?? d.detected_at ?? null
          }))
        } }),
      });
      if (response.ok) {
        const data = await response.json();
        if (typeof data.answer === "string" && data.answer.trim()) answer = data.answer;
      }
    } catch { /* An optional AI service may be offline; use transparent local guidance. */ }
    if (conversationVersion !== conversationVersionRef.current) return;
    if (!answer && forecast) answer = `Four-day outlook for ${forecast.area}: ${forecast.days.map(d => `${d.date}: ${d.similarity}/100 (${level(d.similarity)})`).join("; ")}. These are similarities to historical fire-day weather, NOT wildfire probabilities. Forecast retrieved ${new Date(forecast.retrieved_at).toLocaleString()}.`;
    if (!answer && forecastError) answer = forecastError + " Open AI Forecast to try again.";
    if (!answer) answer = localAnswer(question, areas, detections, contextualArea);
    historyRef.current = [...prior, { role: "user", content: question }, { role: "assistant", content: answer }].slice(-12);
    setMessages((old) => [...old, { role: "assistant", text: answer }]);
    setBusy(false);
  }
  return (
    <div className="ash-shell">
      {open && <section className="ash-panel" aria-label="Ash Detective assistant">
        <header className="ash-head"><div className="ash-avatar"><AshMascot size={38} /></div><div><strong>Ash Detective</strong><span>Wildfire case notes · educational</span></div><button type="button" className="ash-new-chat" onClick={clearChat} aria-label="Start new conversation" title="New conversation">New chat</button><button type="button" className="ash-close" aria-label="Close Ash Detective" onClick={() => setOpen(false)}>×</button></header>
        <div className="ash-messages" role="log" aria-live="polite">{messages.map((m, i) => <div className={`ash-message ash-${m.role}`} key={i}>{m.text}</div>)}{busy && <div className="ash-message ash-assistant">Investigating…</div>}<div ref={endRef} /></div>
        {messages.length === 1 && <div className="ash-suggestions">{contextualQuestions.map((q) => <button type="button" key={q} onClick={() => ask(q)}>{q}</button>)}</div>}
        <form className="ash-compose" onSubmit={(e) => { e.preventDefault(); ask(draft); }}><input aria-label="Ask Ash Detective" placeholder="Ask me anything about the map…" value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)} /><button type="submit" disabled={!draft.trim() || busy} aria-label="Send message">➤</button></form>
        <p className="ash-caution">May be incomplete or outdated · Not emergency advice</p>
      </section>}
      <button type="button" className="ash-launcher" aria-label={open ? "Close Ash Detective" : "Chat with Ash Detective"} aria-expanded={open} onClick={() => setOpen((v) => !v)}><span aria-hidden="true"><AshMascot size={29} /></span><span>{open ? "Close case" : "Ask Ash"}</span></button>
    </div>
  );
}
