import { useEffect, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, useMap, useMapEvents } from "react-leaflet";
import {
  MAX_DESCRIPTION,
  SIGHTINGS,
  buildReportPayload,
  formatPin,
  observedAtUtc,
  parseReportTime,
  reportProblems,
  validLocation,
} from "../utils/reportForm";
import { REPORTS_ENABLED, submitReport } from "../services/reportApi";
import "./ReportFire.css";

// #51: public "Report a Fire" flow, ported from the PRA4 usability-tested prototype (v2).
// Steps: location → what you saw → check → received. Reports wait for staff
// review (#53) and are never sent to 911. Until POST /api/reports (#52) is
// live, the form runs as a preview: everything works except sending.

const INK = "#1B2430"; // colours match prototype v2; layout lives in ReportFire.css


const DISCLAIMER = "This is not an emergency service. If there is immediate danger, call 911.";
const PREVIEW_NOTE = "Preview: reports can't be sent yet. The reporting service is still being built.";

function PinOnClick({ onPick }) {
  useMapEvents({
    click(e) {
      onPick({ latitude: e.latlng.lat, longitude: e.latlng.lng, source: "map" });
    },
  });
  return null;
}

// Zoom to the user's GPS position (a tapped pin keeps the current view).
function CenterOnGps({ pin }) {
  const map = useMap();
  useEffect(() => {
    if (pin?.source === "gps") map.setView([pin.latitude, pin.longitude], 11);
  }, [map, pin]);
  return null;
}

export default function ReportFire({ onClose, onSubmitted, enabled = REPORTS_ENABLED }) {
  const [step, setStep] = useState("location");
  const [pin, setPin] = useState(null);
  const [locError, setLocError] = useState(null);
  const [locating, setLocating] = useState(false);
  const [saw, setSaw] = useState(null);
  const [when, setWhen] = useState("now");
  const [hh, setHh] = useState("");
  const [mm, setMm] = useState("");
  const [ap, setAp] = useState(null);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const time = parseReportTime(hh, mm, ap);
  const seen = observedAtUtc(when, time);
  const form = { pin, saw, when, time, description };
  const detailsReady = SIGHTINGS.includes(saw) && seen.ok;

  function locateMe() {
    if (!navigator.geolocation) {
      setLocError("Location isn't available. Tap the map to mark where the fire is.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setLocError(null);
        setPin({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, source: "gps" });
      },
      () => {
        setLocating(false);
        setLocError("Location isn't available. Tap the map to mark where the fire is.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function onDigits(setter) {
    return (e) => setter(e.target.value.replace(/[^0-9]/g, "").slice(0, 2));
  }

  async function submit() {
    if (submitting || !enabled) return; // no duplicates from double clicks; nothing sent in preview
    const problems = reportProblems(form);
    if (problems.length > 0) {
      setSubmitError(problems.join(" "));
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await submitReport(buildReportPayload(form));
      setReceipt(result);
      setStep("done");
      onSubmitted?.(result);
    } catch (err) {
      setSubmitError(err.message); // answers are kept so the user can retry
    } finally {
      setSubmitting(false);
    }
  }

  const whenText = when === "now" ? "Just now" : `Earlier today, ${time.ok ? time.text : ""}`;

  return (
    <section className="rf-panel" aria-label="Report a fire" role="dialog">
      {!enabled && step !== "done" && <p className="rf-preview" role="note">{PREVIEW_NOTE}</p>}

      {step === "location" && (
        <>
          <p className="rf-hint">Step 1 of 3</p>
          <div className="rf-warn" role="note"><strong>{DISCLAIMER}</strong></div>
          <h2>Where is the fire?</h2>
          <button type="button" className="rf-btn rf-outline" onClick={locateMe} disabled={locating}>
            {locating ? "Finding your location…" : "Use my current location"}
          </button>
          {locError && <p role="status">{locError}</p>}
          <p className="rf-hint">Or tap the map to mark the spot</p>
          <div className="rf-map">
            <MapContainer
              center={[55, -100]}
              zoom={3}
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <CenterOnGps pin={pin} />
              <PinOnClick onPick={(p) => { setPin(p); setLocError(null); }} />
              {pin && (
                <CircleMarker
                  center={[pin.latitude, pin.longitude]}
                  radius={9}
                  pathOptions={{ color: INK, fillColor: "#fff", fillOpacity: 1, weight: 3 }}
                />
              )}
            </MapContainer>
          </div>
          {pin && <p>Location set: {formatPin(pin)}</p>}
          <div className="rf-footer">
            <button type="button" className="rf-btn rf-outline" onClick={onClose}>Cancel</button>
            <button type="button" className="rf-btn rf-primary" disabled={!validLocation(pin)} onClick={() => setStep("details")}>
              Next
            </button>
          </div>
        </>
      )}

      {step === "details" && (
        <>
          <p className="rf-hint">Step 2 of 3</p>
          <h2>What did you see?</h2>
          <div role="group" aria-label="What did you see?" className="rf-chips rf-three">
            {SIGHTINGS.map((option) => (
              <button key={option} type="button" className={saw === option ? "rf-chip on" : "rf-chip"} aria-pressed={saw === option}
                onClick={() => setSaw(option)}>
                {option}
              </button>
            ))}
          </div>

          <p><strong>When did you see it?</strong></p>
          <div role="group" aria-label="When did you see it?" className="rf-chips rf-two">
            <button type="button" className={when === "now" ? "rf-chip on" : "rf-chip"} aria-pressed={when === "now"} onClick={() => setWhen("now")}>
              Just now
            </button>
            <button type="button" className={when === "earlier" ? "rf-chip on" : "rf-chip"} aria-pressed={when === "earlier"} onClick={() => setWhen("earlier")}>
              Earlier today
            </button>
          </div>
          {when === "earlier" && (
            <div className="rf-field">
              <span className="rf-hint">Time you saw it</span>
              <div className="rf-timerow">
                <input aria-label="Hour" inputMode="numeric" placeholder="hh" className="rf-time" value={hh} onChange={onDigits(setHh)} />
                <span>:</span>
                <input aria-label="Minutes" inputMode="numeric" placeholder="mm" className="rf-time" value={mm} onChange={onDigits(setMm)} />
                {["AM", "PM"].map((x) => {
                  const on = time.auto ? time.auto === x : ap === x;
                  return (
                    <button key={x} type="button" className={on ? "rf-chip on" : "rf-chip"} aria-pressed={on}
                      disabled={Boolean(time.auto) && time.auto !== x} onClick={() => setAp(x)}>
                      {x}
                    </button>
                  );
                })}
              </div>
              <p className="rf-hint rf-small">e.g. 5:26 PM or 17:26</p>
              {time.ok && seen.ok && <p role="status">= {time.text}</p>}
              {(time.msg || (time.ok && !seen.ok)) && <p role="alert">{time.msg || seen.msg}</p>}
            </div>
          )}

          <label htmlFor="report-desc"><strong>Anything else?</strong> <span className="rf-hint">(optional)</span></label>
          <textarea id="report-desc" className="rf-text" maxLength={MAX_DESCRIPTION} rows={3}
            placeholder="e.g. Grey smoke behind the trees near the highway"
            value={description} onChange={(e) => setDescription(e.target.value)} />

          <div className="rf-footer">
            <button type="button" className="rf-btn rf-outline" onClick={() => setStep("location")}>Back</button>
            <button type="button" className="rf-btn rf-primary" disabled={!detailsReady} onClick={() => setStep("review")}>Next</button>
          </div>
        </>
      )}

      {step === "review" && (
        <>
          <p className="rf-hint">Step 3 of 3</p>
          <h2>Check your report</h2>
          <div>
            <div className="rf-row"><span className="rf-key">Location</span><span>{formatPin(pin)}</span></div>
            <div className="rf-row"><span className="rf-key">What you saw</span><span>{saw}</span></div>
            <div className="rf-row"><span className="rf-key">When</span><span>{whenText}</span></div>
            <div className="rf-row"><span className="rf-key">Details</span><span>{description.trim() || "None"}</span></div>
          </div>
          <div className="rf-warn" role="note">This report is not sent to 911 or fire services. If there is immediate danger, call 911.</div>
          {submitError && <p role="alert" className="rf-error">{submitError}</p>}
          <div className="rf-footer">
            <button type="button" className="rf-btn rf-outline" onClick={() => setStep("details")} disabled={submitting}>Back</button>
            <button type="button" className="rf-btn rf-fire" onClick={submit} disabled={submitting || !enabled}>
              {!enabled ? "Sending not available yet" : submitting ? "Sending…" : "Submit report"}
            </button>
          </div>
        </>
      )}

      {step === "done" && (
        <>
          <h2>Report received</h2>
          <p>Thank you. Your report was received and is <strong>awaiting review</strong> by staff.</p>
          <p>It has <strong>not</strong> been sent to emergency services. If there is immediate danger, call 911.</p>
          {receipt?.id && <p className="rf-hint">Report ID: {receipt.id}</p>}
          <div className="rf-footer"><button type="button" className="rf-btn rf-primary" onClick={onClose}>Back to map</button></div>
        </>
      )}
    </section>
  );
}
