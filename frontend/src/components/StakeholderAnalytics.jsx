import { Fragment, useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../services/apiConfig";
import "./StakeholderAnalytics.css";

const provinces = {
  all: null, BC: [48, 60, -140, -114], AB: [49, 60, -120, -110],
  ON: [41, 57, -93, -74], QC: [45, 63, -80, -57],
  SK: [49, 60, -110, -101], MB: [49, 60, -102, -89],
};
const valid = n => Number.isFinite(Number(n)) && n !== null && n !== "";
const timestamp = d => d.acq_datetime ?? d.detected_at ?? d.acquired_at ?? d.timestamp ?? d.acq_date ?? null;
const dateMs = d => { const t = Date.parse(timestamp(d)); return Number.isFinite(t) ? t : null; };
const rad = n => n * Math.PI / 180;
function distance(a,b) {
  const dLat=rad(Number(a.latitude)-Number(b.latitude)), dLon=rad(Number(a.longitude)-Number(b.longitude));
  const h=Math.sin(dLat/2)**2+Math.cos(rad(Number(a.latitude)))*Math.cos(rad(Number(b.latitude)))*Math.sin(dLon/2)**2;
  return 12742*Math.asin(Math.min(1,Math.sqrt(h)));
}
export function dbscan(points, radiusKm, minPoints) {
  const labels=Array(points.length).fill(-2); let group=0;
  for(let i=0;i<points.length;i++){
    if(labels[i]!==-2)continue;
    const neighbors=points.map((p,j)=>distance(points[i],p)<=radiusKm?j:-1).filter(j=>j>=0);
    if(neighbors.length<minPoints){labels[i]=-1;continue;}
    labels[i]=group; const queue=[...neighbors], seen=new Set(queue);
    for(let k=0;k<queue.length;k++){
      const j=queue[k]; if(labels[j]===-1)labels[j]=group;
      if(labels[j]!==-2)continue;
      labels[j]=group;
      const near=points.map((p,m)=>distance(points[j],p)<=radiusKm?m:-1).filter(m=>m>=0);
      if(near.length>=minPoints)for(const n of near)if(!seen.has(n)){queue.push(n);seen.add(n);}
    }
    group++;
  }
  return labels;
}
function download(name,body,type){
  const url=URL.createObjectURL(new Blob([body],{type}));
  const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  URL.revokeObjectURL(url);
}
const csvCell = value => '"'+String(value??"").replaceAll('"','""')+'"';
export default function StakeholderAnalytics({areas=[],detections=[],onExplore}){
  const [mode,setMode]=useState("operations"),[province,setProvince]=useState("all"),[windowDays,setWindowDays]=useState("all");
  const [radius,setRadius]=useState(15),[minimum,setMinimum]=useState(3),[selected,setSelected]=useState(null);
  const [variable,setVariable]=useState("relative_humidity_pct");
  const [selectedArea,setSelectedArea]=useState(null),[showAllAreas,setShowAllAreas]=useState(false),[showAllObservations,setShowAllObservations]=useState(false);
  const [reports,setReports]=useState([]),[reportState,setReportState]=useState("loading"),[reportRefresh,setReportRefresh]=useState(0),[reportError,setReportError]=useState("");
  const [reportType,setReportType]=useState("all");
  useEffect(()=>{
    const controller=new AbortController();
    setReportState("loading");
    fetch(`${API_BASE_URL}/api/reports/verified?limit=200`,{signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error(`HTTP ${response.status}${response.status===404?" — endpoint not deployed":""}`);return response.json();})
      .then(body=>{if(!Array.isArray(body.reports))throw new Error("Invalid report data");if(!controller.signal.aborted){setReports(body.reports.filter(r=>r.review_status==="verified"));setReportError("");setReportState("ready");}})
      .catch(error=>{if(!controller.signal.aborted){setReports([]);setReportError(error.message||"Network or CORS error");setReportState("error");}});
    return ()=>controller.abort();
  },[reportRefresh]);
  const visibleReports=useMemo(()=>reports.filter(r=>{
    const bounds=provinces[province],lat=Number(r.latitude),lon=Number(r.longitude);
    return Number.isFinite(lat)&&Number.isFinite(lon)&&(!bounds||(lat>=bounds[0]&&lat<=bounds[1]&&lon>=bounds[2]&&lon<=bounds[3]))&&(reportType==="all"||r.observed_type===reportType);
  }),[reports,province,reportType]);
  const loaded=useMemo(()=>detections.filter(d=>valid(d.latitude)&&valid(d.longitude)&&Math.abs(Number(d.latitude))<=90&&Math.abs(Number(d.longitude))<=180),[detections]);
  const filtered=useMemo(()=>{
    const bounds=provinces[province];
    const mostRecent=Math.max(...loaded.map(dateMs).filter(t=>t!==null),0);
    return loaded.filter(d=>{
      const lat=Number(d.latitude),lon=Number(d.longitude);
      if(bounds&&!(lat>=bounds[0]&&lat<=bounds[1]&&lon>=bounds[2]&&lon<=bounds[3]))return false;
      if(windowDays!=="all"){const t=dateMs(d);if(t===null||t<mostRecent-Number(windowDays)*86400000)return false;}
      return true;
    });
  },[loaded,province,windowDays]);
  const labels=useMemo(()=>dbscan(filtered,radius,minimum),[filtered,radius,minimum]);
  const clusterCount=new Set(labels.filter(n=>n>=0)).size;
  const sortedAreas=useMemo(()=>areas.filter(a=>valid(a.risk_score)).slice().sort((a,b)=>Number(b.risk_score)-Number(a.risk_score)),[areas]);
  const selectedPoint=selected===null?null:filtered[selected]??null;
  const knownDates=loaded.map(dateMs).filter(t=>t!==null);
  const latestDate=knownDates.length?new Date(Math.max(...knownDates)).toLocaleDateString():"Unavailable";
  const exportRows=()=>download("emberwatch-observations.csv",[
    ["latitude","longitude","timestamp","confidence","classification","cluster_id"].join(","),
    ...filtered.map((d,i)=>[d.latitude,d.longitude,timestamp(d),d.confidence,d.classification,labels[i]].map(csvCell).join(","))
  ].join("\n"),"text/csv;charset=utf-8");
  const exportGeo=()=>download("emberwatch-observations.geojson",JSON.stringify({
    type:"FeatureCollection",features:filtered.map((d,i)=>({type:"Feature",geometry:{type:"Point",coordinates:[Number(d.longitude),Number(d.latitude)]},properties:{
      timestamp:timestamp(d),confidence:d.confidence??null,classification:d.classification??null,cluster_id:labels[i]
    }}))
  },null,2),"application/geo+json");
  const factors={temperature_c:"Temperature (°C)",relative_humidity_pct:"Relative humidity (%)",wind_speed_kmh:"Wind speed (km/h)",precipitation_mm:"Precipitation (mm)"};
  const scatter=sortedAreas.map(a=>({name:a.name,x:Number((a.environmental_factors??a.factors??{})[variable]),y:Number(a.risk_score)})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  const maxX=Math.max(...scatter.map(p=>p.x),1),minX=Math.min(...scatter.map(p=>p.x),0),span=Math.max(1,maxX-minX);
  return <section className="ew-analytics" aria-label="Advanced stakeholder analytics">
    <header className="ew-analytics-hero"><div className="ew-analytics-hero-copy"><span>EMBERWATCH / INTELLIGENCE WORKSPACE</span><h1>Investigate the <em>signals.</em></h1><p>Satellite observations, reviewed community reports, and environmental analysis in one workspace.</p><div className="ew-analytics-hero-tags"><span>NASA FIRMS DATA</span><span>STAFF-REVIEWED REPORTS</span><span>EXPLORATORY ANALYSIS</span></div></div><div className="ew-analytics-hero-symbol" aria-hidden="true"><div className="ew-analytics-radar"><i/><i/><i/><b>✦</b></div><small>OBSERVE · ANALYZE · VERIFY</small></div></header>
    <div className="ew-analytics-tabs" role="tablist" aria-label="Stakeholder workspace">
      <button type="button" role="tab" aria-selected={mode==="operations"} onClick={()=>setMode("operations")}>◈ Operations dashboard</button>
      <button type="button" role="tab" aria-selected={mode==="research"} onClick={()=>setMode("research")}>⌁ Research lab</button>
    </div>
    <div className="ew-analytics-panel">
      <h2>{mode==="operations"?"Satellite observation investigation":"Reproducible hotspot exploration"}</h2>
      <p>Filters apply to the records currently loaded by EmberWatch. Province filters use approximate bounding boxes, not administrative boundaries. Date windows are relative to the newest loaded observation, not today.</p>
      <div className="ew-analytics-controls">
        <label>Approximate region<select value={province} onChange={e=>{setProvince(e.target.value);setSelected(null);}}>{Object.keys(provinces).map(p=><option key={p} value={p}>{p==="all"?"All loaded regions":p}</option>)}</select></label>
        <label>Window from newest record<select value={windowDays} onChange={e=>{setWindowDays(e.target.value);setSelected(null);}}><option value="all">All dates</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select></label>
      </div>
      <div className="ew-analytics-metrics"><div><small>Filtered observations</small><strong>{filtered.length}</strong></div><div><small>Newest loaded observation</small><strong>{latestDate}</strong></div><div><small>DBSCAN groups</small><strong>{clusterCount}</strong></div></div>
      {mode==="research"&&<div className="ew-analytics-controls">
        <label>DBSCAN radius: {radius} km<input aria-label="DBSCAN radius" type="range" min="5" max="100" step="5" value={radius} onChange={e=>setRadius(Number(e.target.value))}/></label>
        <label>Minimum observations: {minimum}<input aria-label="Minimum observations" type="range" min="2" max="12" value={minimum} onChange={e=>setMinimum(Number(e.target.value))}/></label>
      </div>}
      <div className="ew-analytics-actions"><button type="button" disabled={!filtered.length} onClick={exportRows}>↓ Export CSV</button><button type="button" disabled={!filtered.length} onClick={exportGeo}>↓ Export GeoJSON</button><button type="button" onClick={onExplore}>Open main map ↗</button></div>
      {!filtered.length?<p role="status">No observations match these filters. No values have been synthesized.</p>:<div className="ew-analytics-table-wrap"><table><thead><tr><th>Observed</th><th>Coordinates</th><th>Confidence</th><th>Cluster</th><th>Inspect</th></tr></thead><tbody>{filtered.slice(0,showAllObservations?100:8).map((d,i)=><tr key={d.id??i}><td>{timestamp(d)??"Unknown"}</td><td>{Number(d.latitude).toFixed(3)}, {Number(d.longitude).toFixed(3)}</td><td>{d.confidence??"Unknown"}</td><td>{labels[i]<0?"Noise":labels[i]+1}</td><td><button type="button" onClick={()=>setSelected(i)}>Details</button></td></tr>)}</tbody></table><small>Showing {Math.min(filtered.length,showAllObservations?100:8)} of {filtered.length} records. Exports include all filtered records. <button type="button" onClick={()=>setShowAllObservations(v=>!v)}>{showAllObservations?"Show fewer":"Show more observations"}</button></small></div>}
      {selectedPoint&&<aside className="ew-analytics-inspect"><h3>Satellite observation</h3><p>Timestamp: {timestamp(selectedPoint)??"Unavailable"}</p><p>Coordinates: {selectedPoint.latitude}, {selectedPoint.longitude}</p><p>Confidence: {String(selectedPoint.confidence??"Unavailable")}</p><p>Classification: {String(selectedPoint.classification??"Unavailable")}</p><p>Satellite observations do not confirm active wildfires.</p><button type="button" onClick={()=>setSelected(null)}>Close details</button></aside>}
    </div>
    {mode==="operations"&&<div className="ew-analytics-panel ew-analytics-reports">
      <div className="ew-analytics-section-head"><div><span className="ew-analytics-kicker">COMMUNITY EVIDENCE / STAFF REVIEWED</span><h2>Verified community reports</h2><p>Actual submitted reports approved by staff. Locations are rounded to approximately 1 km precision for privacy. These are not official incident confirmations.</p></div><button type="button" onClick={()=>setReportRefresh(n=>n+1)}>↻ Refresh reports</button></div>
      <div className="ew-analytics-controls"><label>Reported observation<select value={reportType} onChange={e=>setReportType(e.target.value)}><option value="all">All verified types</option><option value="smoke">Smoke</option><option value="flames">Flames</option><option value="both">Smoke and flames</option></select></label></div>
      {reportState==="loading"?<p role="status">Loading verified community reports…</p>:reportState==="error"?<p role="alert">Verified reports unavailable ({reportError}). Check that the deployed backend supports /api/reports/verified, then retry. Satellite and risk data are unaffected.</p>:visibleReports.length===0?<p role="status">No verified reports match these filters. Unverified and rejected reports are not publicly displayed.</p>:<div className="ew-analytics-table-wrap"><table><thead><tr><th>Report</th><th>Observation</th><th>Approximate coordinates</th><th>Observed at</th><th>Review</th></tr></thead><tbody>{visibleReports.map(r=><tr key={r.id}><td>#{r.id}</td><td>{r.observed_type}</td><td>{Number(r.latitude).toFixed(2)}, {Number(r.longitude).toFixed(2)}</td><td>{r.observed_at?new Date(r.observed_at).toLocaleString():"Unknown"}</td><td>Staff verified</td></tr>)}</tbody></table><small>Showing {visibleReports.length} verified reports returned by the API (up to 200). Verification means a staff review, not emergency-service confirmation.</small></div>}
    </div>}
    {mode==="operations"?<div className="ew-analytics-panel ew-analytics-priority"><h2>Monitored-area prioritization</h2><p>Ranked by modeled environmental risk, not incident severity. Select an area to expand its details immediately below the row.</p>{sortedAreas.length?<div className="ew-analytics-table-wrap"><table><thead><tr><th>Area</th><th>Risk score</th><th>Data status</th><th>Details</th></tr></thead><tbody>{sortedAreas.slice(0,showAllAreas?sortedAreas.length:6).map((a,i)=>{const key=String(a.id??a.name),expanded=selectedArea===key;return <Fragment key={key}><tr className={expanded?"ew-analytics-active-row":""}><td>{a.name}</td><td>{Number(a.risk_score).toFixed(1)}/100</td><td>{a.is_complete===true?"Complete":a.is_complete===false?"Incomplete":"Not assessed"}</td><td><button type="button" className="ew-analytics-area-link" aria-expanded={expanded} onClick={()=>setSelectedArea(expanded?null:key)}>{expanded?"Hide details ▲":"View details ▼"}</button></td></tr>{expanded&&<tr className="ew-analytics-expanded-row"><td colSpan="4"><div className="ew-analytics-inline-detail"><span className="ew-analytics-kicker">AREA DETAILS / {a.name}</span><div className="ew-analytics-inline-stats"><div><small>Modeled risk</small><strong>{Number(a.risk_score).toFixed(1)}/100</strong></div><div><small>Observation time</small><strong>{a.observed_at?new Date(a.observed_at).toLocaleString():"Not provided"}</strong></div><div><small>Input completeness</small><strong>{a.is_complete===true?"Complete":a.is_complete===false?"Incomplete":"Not assessed by this source"}</strong></div></div><p>Risk estimates are not verified wildfire incidents.</p></div></td></tr>}</Fragment>})}</tbody></table>{sortedAreas.length>6&&<button type="button" className="ew-analytics-more" onClick={()=>{setShowAllAreas(v=>!v);setSelectedArea(null);}}>{showAllAreas?"Show top six":"Show all areas"}</button>}</div>:<p>No monitored risk scores loaded.</p>}</div>:
    <div className="ew-analytics-panel"><h2>Environmental variable explorer</h2><label>Horizontal axis <select value={variable} onChange={e=>setVariable(e.target.value)}>{Object.entries(factors).map(([key,name])=><option value={key} key={key}>{name}</option>)}</select></label>{scatter.length?<><svg role="img" aria-label={`Scatter plot of ${factors[variable]} versus modeled risk score`} viewBox="0 0 460 260" className="ew-analytics-chart"><path d="M50 15 V220 H445" stroke="currentColor" fill="none"/>{scatter.map((p,i)=><circle key={i} cx={50+385*(p.x-minX)/span} cy={220-200*p.y/100} r="5" fill="#ff9b55"><title>{p.name}: {p.x} / {p.y}</title></circle>)}<text x="240" y="250" textAnchor="middle" fill="currentColor" fontSize="12">{factors[variable]}</text><text x="15" y="130" transform="rotate(-90 15 130)" textAnchor="middle" fill="currentColor" fontSize="12">Modeled risk / 100</text></svg><p>{scatter.length} monitored areas with available values. This plot does not establish causation.</p></>:<p>No comparable measurements available for this variable.</p>}</div>}
    <p className="ew-analytics-disclaimer">DBSCAN uses great-circle distance and the currently filtered coordinates; cluster numbers are descriptive, not fire incidents. Exports contain observation evidence and cluster labels, not verified emergencies.</p>
  </section>;
}
