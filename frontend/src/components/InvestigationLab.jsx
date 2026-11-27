import { useEffect, useMemo, useState } from "react";
import { predictWeatherPattern } from "../utils/weatherClassifier";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "./InvestigationLab.css";

const has = (n) => typeof n === "number" && Number.isFinite(n);
const fmt = (n, unit = "") => has(n) ? `${n.toFixed(1)}${unit}` : "Unavailable";
const date = (s) => { const d = new Date(s); return s && !Number.isNaN(d.getTime()) ? d.toLocaleString() : "Unknown"; };
const labelStatus = (value) =>
  value
    ? String(value).replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Not recorded";
const prompts = ["Pick a monitored area", "Inspect the environmental score", "Check the observation date", "Compare with satellite evidence"];
const factorNames = {temperature_c:"Temperature",relative_humidity_pct:"Humidity",wind_speed_kmh:"Wind",precipitation_mm:"Precipitation",slope_deg:"Slope"};
function scoreLabel(n) { return !has(n) ? "Unavailable" : n >= 70 ? "High" : n >= 40 ? "Moderate" : "Low"; }
function FactorRows({area}) {
  const factors = area?.factors ?? area?.environmental_factors ?? {};
  return <div className="lab-factors">{Object.entries(factorNames).map(([key,label])=><div key={key}><span>{label}</span><strong>{fmt(factors[key],key.includes("humidity")?"%":key.includes("wind")?" km/h":key.includes("temperature")?"°C":key.includes("precipitation")?" mm":"°")}</strong></div>)}</div>;
}
export default function InvestigationLab({
  areas = [],
  detections = [],
  caseStudy = null,
  onExplore,
}) {
  const locations=useMemo(()=>areas.filter(a=>has(a.latitude)&&has(a.longitude)),[areas]);
  const [tab,setTab]=useState("simulator");
  useEffect(() => {
    if (caseStudy) {
      setTab("caseStudy");
    }
  }, [caseStudy]);
  const [first,setFirst]=useState("");
  const [second,setSecond]=useState("");
  const [values,setValues]=useState({temperature_2m:27,relative_humidity_2m:30,wind_speed_10m:22,precipitation:0});
  const [step,setStep]=useState(0);
  
  const [index,setIndex]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [query,setQuery]=useState("");
  const a=locations.find(x=>String(x.id)===first)??locations[0];
  const b=locations.find(x=>String(x.id)===second)??locations.find(x=>x.id!==a?.id);
  const similarity=predictWeatherPattern(values);
  const dated=useMemo(()=>detections.filter(d=>{const t=d.acq_datetime??d.detected_at??d.acquired_at??d.timestamp??d.acq_date;return t&&!Number.isNaN(new Date(t).getTime());}).map(d=>({...d,_date:(d.acq_datetime??d.detected_at??d.acquired_at??d.timestamp??d.acq_date).slice(0,10)})).sort((x,y)=>x._date.localeCompare(y._date)),[detections]);
  const dates=useMemo(()=>[...new Set(dated.map(d=>d._date))],[dated]);
  const selectedDate=dates[Math.min(index,Math.max(dates.length-1,0))];
  const filtered=dated.filter(d=>d._date===selectedDate);
  useEffect(()=>{if(!playing||dates.length<2)return;const timer=window.setInterval(()=>setIndex(i=>i>=dates.length-1?0:i+1),1100);return()=>window.clearInterval(timer);},[playing,dates.length]);
  const tabs=[
    ["simulator","Weather lab","☀"],
    ["compare","Compare","◈"],
    ["guide","Field mission","✦"],
    ["timeline","Playback","◷"],
    ["caseStudy","Case study","▤"],
  ];
  return <section className="ew-lab" aria-label="Wildfire investigation lab">
    <div className="ew-lab-hero"><div className="ew-lab-hero-copy"><span className="ew-lab-overline">EMBERWATCH / INTERACTIVE FIELD STATION</span><h1>Explore the signals.<br/><em>Find the story.</em></h1><p>Simulate. Compare. Investigate.</p><div className="ew-lab-hero-pills"><span>4 interactive tools</span><span>Real records + labeled simulations</span></div></div><div className="ew-lab-hero-art" aria-hidden="true"><div className="ew-lab-radar"><i/><i/><i/><b>✦</b></div></div></div>
    <div className="ew-lab-tabs" role="tablist" aria-label="Investigation tools">{tabs.map(([id,title,symbol])=><button key={id} type="button" role="tab" aria-selected={tab===id} className={tab===id?"active":""} onClick={()=>setTab(id)}><span className="ew-lab-tab-icon" aria-hidden="true">{symbol}</span><strong>{title}</strong><span className="ew-lab-tab-arrow" aria-hidden="true">↗</span></button>)}</div>
    {tab==="simulator"&&<div className="ew-lab-layout"><div className="ew-lab-panel"><span className="ew-lab-overline">01 / EXPERIMENT</span><h2>Dial in the weather.</h2><p>Move a slider. Watch the pattern change.</p><div className="ew-lab-sliders">{[["temperature_2m","Temperature","°C",-10,45,1],["relative_humidity_2m","Humidity","%",0,100,1],["wind_speed_10m","Wind speed"," km/h",0,100,1],["precipitation","Precipitation"," mm",0,30,.5]].map(([key,label,unit,min,max,step])=><label key={key}><span>{label}<strong>{values[key]}{unit}</strong></span><input type="range" min={min} max={max} step={step} value={values[key]} onChange={e=>setValues(v=>({...v,[key]:Number(e.target.value)}))}/></label>)}</div><button className="ew-lab-reset" type="button" onClick={()=>setValues({temperature_2m:27,relative_humidity_2m:30,wind_speed_10m:22,precipitation:0})}>↺ Reset experiment</button></div><div className="ew-lab-panel ew-lab-result"><span className="ew-lab-overline">LIVE SIMULATION / NOT A FORECAST</span><div className="ew-lab-gauge" style={{"--value":similarity??0}}><div><strong>{similarity??"—"}</strong><small>/100</small></div></div><h2>{has(similarity)?scoreLabel(similarity)+" similarity":"Unavailable"}</h2><div className="ew-lab-caution">SIMULATED WEATHER PATTERN · Not wildfire probability or a live forecast.</div></div></div>}
    {tab==="compare"&&<div className="ew-lab-panel"><span className="ew-lab-overline">02 / REGIONAL COMPARISON</span><h2>Head to head.</h2><p>Two locations. Real recorded scores.</p><div className="ew-lab-selects"><label>Region A<select value={a?String(a.id):""} onChange={e=>setFirst(e.target.value)}>{locations.map(x=><option key={x.id} value={String(x.id)}>{x.name}</option>)}</select></label><label>Region B<select value={b?String(b.id):""} onChange={e=>setSecond(e.target.value)}>{locations.filter(x=>x.id!==a?.id).map(x=><option key={x.id} value={String(x.id)}>{x.name}</option>)}</select></label></div>{a&&b?<div className="ew-lab-comparison">{[a,b].map((area,i)=><article key={i}><span className="ew-lab-overline">CASE FILE / {i===0?"A":"B"}</span><h3>{area.name}</h3><div className="ew-lab-big-score">{has(area.risk_score)?area.risk_score.toFixed(1):"—"}<small>/100</small></div><span className="ew-lab-risk-label">{has(area.risk_score)?scoreLabel(area.risk_score)+" modeled risk":"Score unavailable"}</span><div className="ew-lab-meter"><i style={{width:`${has(area.risk_score)?area.risk_score:0}%`}}/></div><FactorRows area={area}/><p className="ew-lab-timestamp">Observed: {date(area.observed_at)}</p><p className="ew-lab-timestamp">{area.is_complete?"Inputs marked complete":"Some modeled inputs missing"}</p></article>)}</div>:<p role="status">At least two monitored areas are required for comparison.</p>}</div>}
    {tab==="guide"&&<div className="ew-lab-layout"><div className="ew-lab-panel"><span className="ew-lab-overline">03 / GUIDED INVESTIGATION</span><h2>Follow the clues.</h2><p>Four steps to read a wildfire record.</p><div className="ew-lab-steps">{prompts.map((name,i)=><button type="button" key={name} className={step===i?"active":""} onClick={()=>setStep(i)}><span>{String(i+1).padStart(2,"0")}</span>{name}<b>{i<step?"✓":step===i?"→":""}</b></button>)}</div><div className="ew-lab-step-actions"><button type="button" disabled={step===0} onClick={()=>setStep(s=>s-1)}>← Back</button><button type="button" onClick={()=>setStep(s=>(s+1)%4)}>{step===3?"Start again":"Next step →"}</button></div></div><div className="ew-lab-panel ew-lab-mission"><span className="ew-lab-overline">MISSION / {step+1} OF 4</span><h2>{prompts[step]}</h2>{step===0?<><p>Choose your case study.</p><select aria-label="Mission area" value={a?String(a.id):""} onChange={e=>setFirst(e.target.value)}>{locations.map(x=><option key={x.id} value={String(x.id)}>{x.name}</option>)}</select></>:step===1?<><p>{a?.name??"No area"} has a modeled score of <strong>{has(a?.risk_score)?a.risk_score.toFixed(1):"unavailable"}</strong>. This score describes environmental conditions, not a confirmed active wildfire.</p><FactorRows area={a}/></>:step===2?<><p>When was this recorded?</p><div className="ew-lab-mission-highlight">{date(a?.observed_at)}</div><p>{a?.is_complete?"The input record is marked complete.":"The record has missing inputs; interpret cautiously."}</p></>:<><div className="ew-lab-mission-highlight">{detections.length} <small>historical detections</small></div><p>A hotspot is not a confirmed fire. Inspect timestamps and confidence on the map.</p><button className="ew-lab-cta" type="button" onClick={onExplore}>Open Explore map ↗</button></>}</div></div>}
    {tab==="timeline"&&<div className="ew-lab-panel"><span className="ew-lab-overline">04 / HISTORICAL SATELLITE LOG</span><h2>Travel through the data.</h2><p>Play historical satellite observations by date.</p>{dates.length?<><div className="ew-lab-timeline-controls"><button type="button" onClick={()=>setPlaying(v=>!v)} aria-label={playing?"Pause timeline":"Play timeline"}>{playing?"Ⅱ Pause":"▶ Play"}</button><input type="range" aria-label="Observation date" min="0" max={dates.length-1} value={Math.min(index,dates.length-1)} onChange={e=>{setPlaying(false);setIndex(Number(e.target.value));}}/><strong>{selectedDate}</strong></div><div className="ew-lab-timeline-summary"><strong>{filtered.length}</strong><span>observations</span><small>{dates.length} dates</small></div><div className="ew-lab-playback-map" aria-label="Historical satellite detections map"><MapContainer center={[55,-105]} zoom={3} scrollWheelZoom={false} style={{height:"100%",width:"100%"}}><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} className="ew-lab-osm-tiles"/>{filtered.filter(d=>has(Number(d.latitude))&&has(Number(d.longitude))).slice(0,250).map((d,i)=><CircleMarker key={d.id??i} center={[Number(d.latitude),Number(d.longitude)]} radius={6} pathOptions={{color:"#ffad66",fillColor:"#fa673a",fillOpacity:.75,weight:2}}><Popup><strong>Satellite observation</strong><br/>{selectedDate}<br/>Confidence: {d.confidence??"Not provided"}<br/>Not a confirmed wildfire</Popup></CircleMarker>)}</MapContainer><span className="ew-lab-map-caption">Showing up to 250 dated hotspot observations · historical data</span></div><label className="ew-lab-search">Filter displayed records<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Latitude, longitude, confidence…"/></label><div className="ew-lab-records">{filtered.filter(d=>JSON.stringify(d).toLowerCase().includes(query.toLowerCase())).slice(0,35).map((d,i)=><div key={d.id??i}><span>● Observation {i+1}</span><strong>{has(Number(d.latitude))&&has(Number(d.longitude))?`${Number(d.latitude).toFixed(3)}, ${Number(d.longitude).toFixed(3)}`:"Coordinates unavailable"}</strong><small>{d.confidence!=null?`Confidence: ${String(d.confidence)}`:"Confidence not provided"}</small></div>)}</div></>:<p role="status" className="ew-lab-caution">No dated satellite detection records are loaded. Try again when the data service is available.</p>}</div>}
    {tab === "caseStudy" && (
      <div className="ew-lab-panel ew-lab-case-study">
        <span className="ew-lab-overline">05 / HISTORICAL CASE STUDY</span>

        {caseStudy ? (
          <>
            <h2>
              {caseStudy.event_type === "community_report"
                ? "Community-reported fire"
                : "Satellite observation"}
            </h2>

            <p>
              Examine the recorded evidence, its provenance, and any available
              lifecycle information. Missing metadata does not make a record
              ineligible for investigation.
            </p>

            <div className="ew-lab-case-grid">
              <div>
                <span>Observed</span>
                <strong>{date(caseStudy.event_at)}</strong>
              </div>

              <div>
                <span>Location</span>
                <strong>
                  {caseStudy.latitude != null && caseStudy.longitude != null
                    ? `${Number(caseStudy.latitude).toFixed(3)}, ${Number(caseStudy.longitude).toFixed(3)}`
                    : "Unavailable"}
                </strong>
              </div>

              <div>
                <span>Source</span>
                <strong>{caseStudy.source || "Not provided"}</strong>
              </div>

              <div>
                <span>Confidence</span>
                <strong>
                  {caseStudy.confidence != null
                    ? caseStudy.confidence
                    : "Not provided"}
                </strong>
              </div>

              <div>
                <span>Review status</span>
                <strong>{labelStatus(caseStudy.review_status)}</strong>
              </div>

              <div>
                <span>End time</span>
                <strong>{date(caseStudy.ended_at)}</strong>
              </div>
            </div>

            {caseStudy.event_type === "community_report" ? (
              <>
                <h3>Report lifecycle</h3>

                <p>
                  {caseStudy.location_source === "approximate"
                    ? "The displayed coordinates are approximate and have been rounded to protect the reporter's privacy."
                    : "This record originates from a community report."}
                </p>

                {Array.isArray(caseStudy.status_history) &&
                caseStudy.status_history.length > 0 ? (
                  <ol className="ew-lab-case-history">
                    {caseStudy.status_history.map((entry, index) => (
                      <li key={entry.id ?? index}>
                        <strong>
                          {labelStatus(
                            entry.old_status ?? entry.from_status ?? "Initial"
                          )}
                          {" → "}
                          {labelStatus(
                            entry.new_status ?? entry.to_status
                          )}
                        </strong>
                        <small>
                          {date(entry.changed_at ?? entry.created_at)}
                        </small>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>No status history is available for this record.</p>
                )}
              </>
            ) : (
              <>
                <h3>Satellite observation details</h3>

                <div className="ew-lab-case-grid">
                  <div>
                    <span>Satellite</span>
                    <strong>{caseStudy.satellite || "Not provided"}</strong>
                  </div>

                  <div>
                    <span>Instrument</span>
                    <strong>{caseStudy.instrument || "Not provided"}</strong>
                  </div>

                  <div>
                    <span>Confidence class</span>
                    <strong>{caseStudy.confidence_class || "Not provided"}</strong>
                  </div>

                  <div>
                    <span>Fire radiative power</span>
                    <strong>
                      {caseStudy.frp != null
                        ? `${caseStudy.frp} MW`
                        : "Not provided"}
                    </strong>
                  </div>
                </div>

                <p className="ew-lab-caution">
                  A satellite hotspot is an observation, not confirmation of an
                  active wildfire. Confidence describes the satellite observation,
                  not wildfire probability.
                </p>
              </>
            )}

            <button
              className="ew-lab-cta"
              type="button"
              onClick={onExplore}
            >
              Open Explore map ↗
            </button>
          </>
        ) : (
          <>
            <h2>No case study selected.</h2>
            <p>
              Open Historical fire records in Explore and select
              "Use as case study" on a record to investigate it here.
            </p>
            <button
              className="ew-lab-cta"
              type="button"
              onClick={onExplore}
            >
              Browse historical records ↗
            </button>
          </>
        )}
      </div>
    )}

    <div className="ew-lab-footer">
      <div>
        <strong>Explore with context.</strong>
        <p>Educational data only · Not emergency guidance.</p>
      </div>
      <button type="button" onClick={onExplore}>
        Investigate on the map ↗
      </button>
    </div>
    
  </section>;
}
