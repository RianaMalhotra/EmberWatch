import { useEffect, useState } from "react";
import { MODEL, summarizeDay, level } from "../utils/weatherClassifier";
import "./ForecastPage.css";

const FIELDS = "temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation";
const valid = (v) => typeof v === "number" && Number.isFinite(v);
function Trend({ days }) {
  const coords = days.map((d,i)=>`${42+i*168},${166-d.average*1.32}`).join(" ");
  return <div className="ew-fc-chart" role="img" aria-label={`Four-day historical weather-pattern similarity: ${days.map(d=>d.average).join(", ")} out of 100`}>
    <svg viewBox="0 0 590 205" preserveAspectRatio="none" aria-hidden="true">
      {[25,50,75].map(n=><g key={n}><line x1="38" x2="575" y1={166-n*1.32} y2={166-n*1.32} stroke="#5c453d" strokeDasharray="4 7"/><text x="5" y={170-n*1.32} fill="#b49a8d" fontSize="11">{n}</text></g>)}
      <polyline points={coords} fill="none" stroke="#f7a66d" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
      {days.map((d,i)=><g key={d.date}><circle cx={42+i*168} cy={166-d.average*1.32} r="6" fill="#f7a66d" stroke="#34231f" strokeWidth="3"/><text x={42+i*168} y="193" fill="#e4c6b5" fontSize="12" textAnchor="middle">{new Date(d.date+"T12:00:00").toLocaleDateString(undefined,{weekday:"short"})}</text></g>)}
    </svg>
  </div>;
}
export default function ForecastPage({ areas = [] }) {
  const locations = areas.filter(a=>valid(a.latitude)&&valid(a.longitude));
  const [areaId,setAreaId]=useState("");
  const [selectedDay,setSelectedDay]=useState(0);
  const [selectedHour,setSelectedHour]=useState(12);
  const [refresh,setRefresh]=useState(0);
  const [state,setState]=useState({loading:false,data:null,error:""});
  const chosen=locations.find(a=>String(a.id)===areaId)??locations[0];
  useEffect(()=>{
    if(!chosen){setState({loading:false,data:null,error:""});return;}
    const controller=new AbortController();
    setState({loading:true,data:null,error:""});
    const query=new URLSearchParams({latitude:String(chosen.latitude),longitude:String(chosen.longitude),hourly:FIELDS,forecast_days:"4",timezone:"auto"});
    fetch(`https://api.open-meteo.com/v1/forecast?${query}`,{signal:controller.signal})
      .then(async r=>{if(!r.ok)throw Error("Weather forecast service unavailable");return r.json();})
      .then(data=>{
        if(!Array.isArray(data?.hourly?.time))throw Error("Incomplete forecast response");
        const dates=[...new Set(data.hourly.time.map(t=>t.slice(0,10)))].slice(0,4);
        const days=dates.map(date=>summarizeDay(data.hourly,date));
        if(days.length!==4||days.some(d=>!d))throw Error("Weather inputs missing; ML output withheld");
        setSelectedDay(0);
        setSelectedHour(12);
        setState({loading:false,error:"",data:{days,hourly:data.hourly,timezone:data.timezone,retrieved:new Date().toISOString()}});
      }).catch(e=>{if(!controller.signal.aborted)setState({loading:false,data:null,error:e.message||"Forecast unavailable"});});
    return ()=>controller.abort();
  },[chosen?.id,chosen?.latitude,chosen?.longitude,refresh]);
  const days=state.data?.days??[];
  const day=days[selectedDay]??days[0];
  const hourIndices=day?state.data?.hourly?.time?.map((t,i)=>t.startsWith(day.date)?i:-1).filter(i=>i>=0)??[]:[];
  const hourIndex=hourIndices[Math.min(selectedHour,Math.max(0,hourIndices.length-1))];
  const hourly=state.data?.hourly;
  const hourTime=hourIndex!==undefined?hourly.time[hourIndex]?.slice(11,16):null;
  const hourMetrics=hourIndex!==undefined?{temperature:hourly.temperature_2m?.[hourIndex],humidity:hourly.relative_humidity_2m?.[hourIndex],wind:hourly.wind_speed_10m?.[hourIndex],precipitation:hourly.precipitation?.[hourIndex]}:null;
  return <section className="ew-forecast" aria-label="Experimental ML wildfire weather forecast">
    <div className="ew-fc-hero">
      <div className="ew-fc-hero-content">
        <div className="ew-fc-kicker"><span className="ew-fc-pulse"/> EMBERWATCH / INTELLIGENCE LAB <span className="ew-fc-version">ML EXPERIMENT</span></div>
        <h1>See the conditions.<br/><em>Understand the patterns.</em></h1>
        <p>A four-day weather outlook interpreted by a trained logistic regression model. Explore how closely forecast conditions resemble a small set of historical wildfire-event days.</p>
        <div className="ew-fc-hero-foot"><span>✦ Trained ML classifier</span><span>◷ 4-day weather outlook</span><span>◎ Canadian monitored areas</span></div>
      </div>
      <div className="ew-fc-hero-art" aria-hidden="true"><div className="ew-fc-orbit a"/><div className="ew-fc-orbit b"/><div className="ew-fc-orbit c"/><span>✺</span></div>
    </div>
    <div className="ew-fc-warning" role="note"><strong>Research prototype — not a wildfire probability.</strong> Trained on just {MODEL.training_examples} selected historical examples from {MODEL.independent_events} fire events. Scores measure resemblance to these examples, not the chance of a fire. Do not use for safety decisions.</div>
    <div className="ew-fc-workspace">
      <div className="ew-fc-controls"><div><span className="ew-fc-overline">01 / LOCATION</span><h2>Choose a monitored region</h2></div><div className="ew-fc-actions"><select aria-label="Monitored region" value={chosen?String(chosen.id):""} onChange={e=>setAreaId(e.target.value)} disabled={!chosen}>{locations.map(a=><option key={a.id} value={String(a.id)}>{a.name??`Area ${a.id}`}</option>)}</select><button type="button" onClick={()=>setRefresh(n=>n+1)} disabled={!chosen||state.loading}>↻ Refresh</button></div></div>
      {!chosen&&<p role="status" className="ew-fc-empty">No monitored regions are available. Check the data connection.</p>}
      {state.loading&&<p role="status" className="ew-fc-empty">Retrieving forecast weather and evaluating the model…</p>}
      {state.error&&<p role="alert" className="ew-fc-empty">Unable to display model output: {state.error}</p>}
      {day&&<><div className="ew-fc-body">
        <div className="ew-fc-primary">
          <span className="ew-fc-overline">02 / FORECAST WEATHER PATTERN</span>
          <div className="ew-fc-headline"><div><h2>{new Date(day.date+"T12:00:00").toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"})}</h2><p>Mean model similarity across the day</p></div><div className="ew-fc-score">{day.average}<small>/100</small></div></div>
          <div className="ew-fc-level"><span className="ew-fc-level-dot"/> {level(day.average)} to historical fire-day weather</div>
          <div className="ew-fc-chart-heading"><strong>Four-day model outlook</strong><span>Daily mean similarity score</span></div>
          <Trend days={days}/>
          <div className="ew-fc-days">{days.map((d,i)=><button type="button" key={d.date} className={selectedDay===i?"active":""} aria-pressed={selectedDay===i} onClick={()=>{setSelectedDay(i);setSelectedHour(12);}}><span>{i===0?"TODAY":i===1?"TOMORROW":`DAY ${i+1}`}</span><strong>{d.average}<small>/100</small></strong><span>{new Date(d.date+"T12:00:00").toLocaleDateString(undefined,{month:"short",day:"numeric"})}</span></button>)}</div>
        </div>
        <aside className="ew-fc-side"><span className="ew-fc-overline">03 / WEATHER SIGNALS</span><h2>Behind the estimate</h2><p>Forecast inputs for the selected day. These are weather measurements, not wildfire detections.</p>
          <div className="ew-fc-metrics"><div><span>Temperature · midday</span><strong>{day.temperature.toFixed(1)}°C</strong></div><div><span>Relative humidity · midday</span><strong>{day.humidity.toFixed(0)}%</strong></div><div><span>Wind speed · midday</span><strong>{day.wind.toFixed(1)} km/h</strong></div><div><span>Daily precipitation</span><strong>{day.precipitation.toFixed(1)} mm</strong></div></div>
          <div className="ew-fc-method"><span>MODEL</span><strong>Logistic regression</strong><p>Trained on historical fire-day weather vs selected comparison dates. No calibration to real wildfire incidence.</p></div>
        </aside>
      </div><div className="ew-fc-hourly"><div className="ew-fc-hourly-title"><div><span className="ew-fc-overline">04 / HOURLY WEATHER EXPLORER</span><h2>Scrub through the day.</h2><p>Explore the actual hourly forecast inputs for your selected day, instead of only the midday summary.</p></div><span className="ew-fc-hourly-time">{hourTime??"—"}</span></div><input aria-label="Forecast hour" type="range" min="0" max={Math.max(0,hourIndices.length-1)} value={Math.min(selectedHour,Math.max(0,hourIndices.length-1))} onChange={e=>setSelectedHour(Number(e.target.value))}/><div className="ew-fc-hourly-labels"><span>00:00</span><span>12:00</span><span>23:00</span></div><div className="ew-fc-hourly-metrics">{[["Temperature",hourMetrics?.temperature,"°C"],["Humidity",hourMetrics?.humidity,"%"],["Wind",hourMetrics?.wind," km/h"],["Precipitation",hourMetrics?.precipitation," mm"]].map(([label,value,unit])=><div key={label}><span>{label}</span><strong>{typeof value==="number"&&Number.isFinite(value)?value.toFixed(1)+unit:"—"}</strong></div>)}</div><p className="ew-fc-hourly-note">Weather values are Open-Meteo forecasts, not measured wildfire activity. Daily model similarity remains experimental.</p></div><div className="ew-fc-provenance">WEATHER: OPEN-METEO · TIME ZONE: {state.data.timezone||"UNKNOWN"} · RETRIEVED {new Date(state.data.retrieved).toLocaleString()}</div></>}
    </div>
    <section className="ew-fc-fieldnotes" aria-labelledby="ew-fc-fieldnotes-title">
      <div className="ew-fc-fieldnotes-intro">
        <span className="ew-fc-fieldnotes-eyebrow">FIELD NOTES <span aria-hidden="true">/</span> THE METHOD</span>
        <h2 id="ew-fc-fieldnotes-title">What this forecast<br/><em>actually tells you.</em></h2>
        <p>A closer look at the data, the comparison and the boundaries of this experiment.</p>
        <span className="ew-fc-fieldnotes-rule" aria-hidden="true"/>
      </div>
      <div className="ew-fc-fieldnotes-details">
        <div className="ew-fc-fieldnote">
          <span className="ew-fc-fieldnote-index">I.</span>
          <div><h3>Built from weather records</h3><p>The model learns relationships between temperature, humidity, wind and precipitation from selected historical examples. It is a regularized logistic regression classifier, not a hand-tuned index.</p></div>
        </div>
        <div className="ew-fc-fieldnote">
          <span className="ew-fc-fieldnote-index">II.</span>
          <div><h3>A promising comparison, with caveats</h3><p>Fire-event days scored above both chosen comparison dates in {MODEL.group_holdout_fire_above_both_controls} of {MODEL.group_holdout_events} held-out events. With so few, selectively sampled examples, that result does not establish forecasting accuracy.</p></div>
        </div>
        <div className="ew-fc-fieldnote">
          <span className="ew-fc-fieldnote-index">III.</span>
          <div><h3>Not an emergency forecast</h3><p>These scores describe similarity to past weather conditions—not the likelihood of ignition, fire spread or an active threat. Always use official wildfire alerts for safety decisions.</p></div>
        </div>
      </div>
    </section>
  </section>;
}
