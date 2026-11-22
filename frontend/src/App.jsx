
import { useEffect, useMemo, useRef, useState } from "react";
import "./prototype.css";
import { fetchRiskAreas } from "./services/riskApi";
import ReportFire from "./components/ReportFire";
import ErrorBoundary from "./components/ErrorBoundary";
import { REPORTS_ENABLED } from "./services/reportApi";
import { fetchDetections } from "./services/detectionApi";
import { describeLoadError } from "./utils/loadError";
import DataFreshness from "./components/DataFreshness";
import {
  classificationLabel,
  detectionSummary,
  formatConfidence,
  formatCoordinates,
  formatDetectionTime,
} from "./utils/detectionFormat";
import {
  FACTOR_LABELS as factorLabels,
  areaBounds,
  missingInputNames,
  riskAreaStyle,
  validRiskScore,
  riskColor,
  riskState,
  riskStatusText,
  weatherObservedText,
} from "./utils/riskFormat";
import { MapContainer, TileLayer, CircleMarker, Circle, Marker, Popup, Tooltip, useMap } from "react-leaflet";
import { divIcon } from "leaflet";
import { RISK_ZONE_RADIUS_M, riskZoneStyle } from "./utils/riskZone";
import "leaflet/dist/leaflet.css";
import { explainFactors } from "./utils/riskExplanation";
import { sortAreasByRisk } from "./utils/riskFormat";
import RiskLegend from "./components/RiskLegend";
import AshDetective from "./components/AshDetective";
import ForecastPage from "./components/ForecastPage";
import InvestigationLab from "./components/InvestigationLab";
import StakeholderAnalytics from "./components/StakeholderAnalytics";
import { clusterDetections, MapZoomObserver } from "./components/DetectionClusters";
import { findHotspotClusters } from "./utils/hotspotDbscan";
import HotspotDiscoveryPanel from "./components/HotspotDiscoveryPanel";

const fireMarkerIcon = (lowConfidence) => divIcon({
  className: "ew-fire-marker-wrap",
  html: `<span class="ew-fire-marker ${lowConfidence ? "ew-fire-marker-low" : "ew-fire-marker-likely"}" aria-hidden="true">🔥</span>`,
  iconSize: [26, 30],
  iconAnchor: [13, 25],
  popupAnchor: [0, -23],
});

const factorUnits = {
  temperature_c: "°C",
  relative_humidity_pct: "%",
  wind_speed_kmh: "km/h",
  precipitation_mm: "mm",
  slope_deg: "°",
};

// Fit the initial map to Canada rather than only the currently monitored areas.
function FitToAreas({ areas }) {
  const map = useMap();
  const points = areaBounds(areas);
  const key = points.map((p) => p.join(",")).join(";");

  useEffect(() => {
    if (points.length > 0) {
      map.fitBounds([[42, -141], [83, -52]], { padding: [18, 18], maxZoom: 5 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);

  return null;
}

// Pan when an area selected from the list is outside the visible map.
function FocusSelected({ area }) {
  const map = useMap();
  useEffect(() => {
    if (!area || !Number.isFinite(area.latitude) || !Number.isFinite(area.longitude)) return;
    const point = [area.latitude, area.longitude];
    // Always focus a selected search result; preserve the existing pan-only test map.
    if (typeof map.flyTo === "function") {
      map.flyTo(point, Math.max(map.getZoom?.() ?? 6, 10), { animate: true, duration: 0.9 });
    } else if (map.getBounds && !map.getBounds().contains(point)) {
      map.panTo(point);
    }
  }, [map, area]);
  return null;
}

function RefreshMapLayout({ active, hasSelection }) {
  const map = useMap();
  useEffect(() => {
    if (active) {
      map.invalidateSize?.();
      const frame = requestAnimationFrame(() => {
        map.invalidateSize?.();
        if (!hasSelection) map.setView?.([54.5, -119], 6, { animate: false });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [map, active]);
  return null;
}

function AppContent() {
  const [riskAreas, setRiskAreas] = useState([]);
  const [homeMotion, setHomeMotion] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" ? !window.matchMedia("(prefers-reduced-motion: reduce)").matches : false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedArea, setSelectedArea] = useState(null);
  const [showZones, setShowZones] = useState(false);
  const [search, setSearch] = useState("");
  const [placeMatches, setPlaceMatches] = useState([]);
  const [placeRetry, setPlaceRetry] = useState(0);
  const [placeLoading, setPlaceLoading] = useState(false);
  const [placeError, setPlaceError] = useState("");
  const [searchedPlace, setSearchedPlace] = useState(null);
  const [selectedDetection, setSelectedDetection] = useState(null);
  const [showFullDetails, setShowFullDetails] = useState(false);
  const [view, setView] = useState("dashboard");
  const [page, setPage] = useState("home");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDataNotes, setShowDataNotes] = useState(false);
  const [showAreaList, setShowAreaList] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [mapLayer, setMapLayer] = useState("both");
  const [basemap, setBasemap] = useState("hybrid");
  const [mapControlsOpen, setMapControlsOpen] = useState(true);
  const [legendOpen, setLegendOpen] = useState(true);
  const [mapZoom, setMapZoom] = useState(6);
  useEffect(() => {
    if (page === "explore") {
      setMapControlsOpen(true);
      setLegendOpen(true);
    }
  }, [page]);
  const [clusterZoomTarget, setClusterZoomTarget] = useState(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(true);
  const menuRef = useRef(null);
  const detailsRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function closeMenu(event) {
      if (event.type === "keydown" && event.key === "Escape") setMenuOpen(false);
      if (event.type === "pointerdown" && !menuRef.current?.contains(event.target)) setMenuOpen(false);
    }
    document.addEventListener("keydown", closeMenu);
    document.addEventListener("pointerdown", closeMenu);
    return () => {
      document.removeEventListener("keydown", closeMenu);
      document.removeEventListener("pointerdown", closeMenu);
    };
  }, [menuOpen]);
  const [detectionResult, setDetectionResult] = useState(null);
  const [detectionError, setDetectionError] = useState(null);
  const [reporting, setReporting] = useState(false); // #51 Report a Fire panel
  const [detectionLoading, setDetectionLoading] = useState(true);
  // #25/#26: warnings from the API (e.g. fire history unavailable), plus
  // counters that re-run a load when the user presses "Try again".
  const [warnings, setWarnings] = useState([]);
  const [riskAttempt, setRiskAttempt] = useState(0);
  const [detectionAttempt, setDetectionAttempt] = useState(0);

  // #18: detections load separately from risk areas, so if one request fails
  // the other still shows (see #4, reliable handling of failures).
  useEffect(() => {
    let active = true;

    async function loadDetections() {
      setDetectionLoading(true);
      try {
        const result = await fetchDetections();

        if (!active) return;

        setDetectionResult(result);
        setDetectionError(null);
      } catch (err) {
        if (!active) return;

        // Show an error, never invented detections.
        setDetectionResult(null);
        setDetectionError(describeLoadError(err, "Unable to load wildfire detections."));
      } finally {
        if (active) setDetectionLoading(false);
      }
    }

    loadDetections();

    return () => {
      active = false;
    };
  }, [detectionAttempt]);

  useEffect(() => {
    let active = true;

    async function loadRiskAreas() {
      setLoading(true);
      try {
        const result = await fetchRiskAreas();

        if (!active) return;

        setRiskAreas(result.data);
        setWarnings(Array.isArray(result.warnings) ? result.warnings : []);
        setError(null);
      } catch (err) {
        if (!active) return;

        setRiskAreas([]);
        setWarnings([]);
        setError(describeLoadError(err, "Unable to load wildfire risk data."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadRiskAreas();

    return () => {
      active = false;
    };
  }, [riskAttempt]);

  // Open-Meteo's Canadian geocoding search supports autocomplete beyond the monitored-area list.
  useEffect(() => {
    const query = search.trim();
    if (query.length < 2 || (searchedPlace && query === searchedPlace.name)) {
      setPlaceMatches([]);
      setPlaceLoading(false);
      setPlaceError("");
      return;
    }
    const controller = new AbortController();
    setPlaceMatches([]);
    setSuggestionIndex(-1);
    setPlaceLoading(true);
    setPlaceError("");
    const timer = setTimeout(async () => {
      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10&language=en&format=json&countryCode=CA`;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Location search is unavailable");
        const data = await response.json();
        if (!controller.signal.aborted) {
          setPlaceMatches((Array.isArray(data.results) ? data.results : []).filter(
            (place) => place.country_code === "CA" && Number.isFinite(place.latitude) && Number.isFinite(place.longitude)
          ).slice(0, 6));
        }
      } catch (error) {
        if (!controller.signal.aborted) { setPlaceMatches([]); setPlaceError("Location suggestions are unavailable. Try again."); }
      } finally {
        if (!controller.signal.aborted) setPlaceLoading(false);
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, searchedPlace, placeRetry]);

  function choosePlace(place) {
    const name = [place.name, place.admin1].filter(Boolean).join(", ");
    const monitored = riskAreas.find((area) => (area.name ?? "").toLowerCase() === place.name.toLowerCase());
    setSearch(name);
    setPlaceMatches([]);
    setSearchedPlace({ name, latitude: place.latitude, longitude: place.longitude });
    setSelectedDetection(null);
    setDetailsExpanded(false);
    if (monitored) selectArea(monitored);
    else { setSelectedArea(null); setShowFullDetails(false); setView("dashboard"); }
    setPage("explore");
  }

  const mlHotspotClusters = useMemo(
    () => findHotspotClusters(detectionResult?.detections ?? []),
    [detectionResult?.detections]
  );

  const nearbyDetections = useMemo(() => searchedPlace && detectionResult?.detections
    ? detectionResult.detections.filter((d) => {
        const lat = (d.latitude - searchedPlace.latitude) * Math.PI / 180;
        const lon = (d.longitude - searchedPlace.longitude) * Math.PI / 180;
        const a = Math.sin(lat / 2) ** 2 + Math.cos(searchedPlace.latitude * Math.PI / 180) * Math.cos(d.latitude * Math.PI / 180) * Math.sin(lon / 2) ** 2;
        return 12742 * Math.asin(Math.min(1, Math.sqrt(a))) <= 50;
      })
    : [], [searchedPlace, detectionResult?.detections]);

  function retryRiskAreas() {
    setLoading(true);
    setError(null);
    setRiskAttempt((n) => n + 1);
  }

  function retryDetections() {
    setDetectionLoading(true);
    setDetectionError(null);
    setDetectionAttempt((n) => n + 1);
  }

  const factors = selectedArea?.environmental_factors ?? {};
  const mapClusters = useMemo(() => clusterDetections(detectionResult?.detections ?? [], mapZoom), [detectionResult?.detections, mapZoom]);
  const filteredAreas = useMemo(() => sortAreasByRisk(riskAreas)
    .filter((area) => (area.name ?? `Area ${area.id}`).toLowerCase().includes(search.trim().toLowerCase())), [riskAreas, search]);
  function navigateTo(nextPage) {
    if (nextPage === "explore") { setMapControlsOpen(true); setLegendOpen(true); }
    setPage(nextPage);
    setReporting(false);
    setMenuOpen(false);
  }

  function selectArea(area) {
    navigateTo("explore");
    setSelectedArea(area);
    setDetailsExpanded(false);
    setSelectedDetection(null);
    setSearchedPlace(null);
    setShowFullDetails(false);
    setView("information");
    if (window.matchMedia?.("(max-width: 860px)").matches) {
      requestAnimationFrame(() => {
        detailsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
        detailsRef.current?.focus?.({ preventScroll: true });
      });
    }
  }

  return (
    <div className={`ew-app ew-view-${view}`}>
      <header className="ew-header">
        <div className="ew-header-left">
        {page === "explore" && view !== "dashboard" && <button className="ew-nav-back" type="button" onClick={() => { if(view === "risk") {setView("information");setShowFullDetails(false);} else {setView("dashboard");setSelectedArea(null);setSelectedDetection(null);} }}>← Back</button>}
        <button type="button" className="ew-brand ew-brand-button" aria-label="Go to EmberWatch home" onClick={() => {navigateTo("home");setView("dashboard");}}>
        <span className="ew-brand-icon" aria-hidden="true">🔥</span>
        <span>EMBER<span className="ew-brand-accent">WATCH</span>
        </span>
        </button>
        </div>
        <a className="ew-skip-link" href="#ew-main-content">Skip to main content</a><nav className="ew-top-nav" aria-label="Main navigation">
          <button type="button" aria-current={page === "home" ? "page" : undefined} onClick={() => navigateTo("home")}>Overview</button>
          <button type="button" aria-current={page === "explore" ? "page" : undefined} onClick={() => navigateTo("explore")}>Explore</button>
          <button type="button" aria-current={page === "learn" ? "page" : undefined} onClick={() => navigateTo("learn")}>Learn</button>
          <button type="button" aria-current={page === "forecast" ? "page" : undefined} onClick={() => navigateTo("forecast")}>Forecast</button>
        </nav>
        <div className="ew-menu-wrap" ref={menuRef}>
          <button type="button" className="ew-menu-toggle" aria-label="More options" aria-expanded={menuOpen} aria-controls="ew-navigation" onClick={() => setMenuOpen((open) => !open)}>
            <span aria-hidden="true">☰</span><span>More</span>
          </button>
          {menuOpen && <nav id="ew-navigation" className="ew-navigation" aria-label="Map settings">
            <strong>More options</strong>
            <button type="button" onClick={() => navigateTo("lab")}>Investigation lab · Compare and replay</button>
            <button type="button" onClick={() => navigateTo("analytics")}>Advanced analytics · Operations & Research</button>
            <button type="button" onClick={() => { navigateTo("learn"); }}>How risk works</button>
            <button type="button" onClick={() => { setPage("explore"); setReporting(true); setMenuOpen(false); }}>Report a Fire {REPORTS_ENABLED ? "" : "(preview)"}</button>
            <p>EmberWatch is an educational risk explorer, not an emergency alert service.</p>
          </nav>}
        </div>
        </header>
      <main className="ew-main" id="ew-main-content" tabIndex={-1}>
      {page === "home" && <section className={`ew-home ew-home-inferno ${homeMotion ? "ew-home-motion-on" : "ew-home-motion-off"}`} aria-label="EmberWatch home">
        <div className="ew-home-spark-field" aria-hidden="true">{Array.from({length:28},(_,i)=><i key={i} style={{"--spark-x":`${(i*37+13)%100}%`,"--spark-delay":`${-(i*0.73)%11}s`,"--spark-duration":`${4+(i%6)*.9}s`,"--spark-drift":`${(i%2?1:-1)*(20+i%5*18)}px`,"--spark-size":`${2+(i%4)}px`}} />)}</div>
        <div className="ew-home-hero"><button className="ew-home-motion-toggle" type="button" aria-pressed={homeMotion} onClick={() => setHomeMotion(v => !v)}>{homeMotion ? "✦ Reduce animations" : "✦ Enable animations"}</button>
          <div className="ew-home-status"><span className="ew-home-status-dot" /> WILDFIRE INTELLIGENCE PLATFORM <span className="ew-home-status-divider">/</span> CANADA</div>
          <span className="ew-home-edition">SATELLITE OBSERVATIONS <span>✦</span> ENVIRONMENTAL INSIGHTS <span>✦</span> ML RESEARCH</span>
          <h1>WATCH THE <em>WILDFIRE.</em><br /><span>READ THE SIGNALS.</span></h1>
          <p>From satellite hotspots to environmental risk and experimental machine learning—explore the data behind Canada's changing wildfire landscape.</p>
          <form className="ew-home-place-search" role="search" onSubmit={(event) => { event.preventDefault(); if (placeMatches.length) choosePlace(placeMatches[0]); else { const match = riskAreas.find((area) => (area.name ?? "").toLowerCase().includes(search.trim().toLowerCase())); if (match && search.trim()) selectArea(match); else navigateTo("explore"); } }}><label htmlFor="ew-home-location">Check a location</label><div className="ew-home-place-row"><input id="ew-home-location" type="search" value={search} onChange={(event) => {setSearch(event.target.value);setSearchedPlace(null);}} placeholder="Search a Canadian city or monitored area" autoComplete="off" /><button type="submit">Find on map →</button></div>{search.trim().length >= 2 && <div className="ew-home-place-results" aria-label="Location suggestions" aria-live="polite">{!placeLoading && !placeError && !placeMatches.length && !riskAreas.some(area => (area.name ?? "").toLowerCase().includes(search.trim().toLowerCase())) && <span>No matching locations. Try another Canadian city or province.</span>}{placeLoading && <span>Searching locations…</span>}{placeError && <span>{placeError} <button type="button" onClick={() => setPlaceRetry(n => n + 1)}>Retry search</button></span>}{placeMatches.map((place) => <button type="button" key={place.id} onClick={() => choosePlace(place)}>{place.name}{place.admin1 ? `, ${place.admin1}` : ""}</button>)}{riskAreas.filter((area) => (area.name ?? "").toLowerCase().includes(search.trim().toLowerCase())).slice(0, 4).map((area) => <button type="button" key={`area-${area.id}`} onClick={() => selectArea(area)}>{area.name} · monitored area</button>)}</div>}</form>
          <p className="ew-selection-disclaimer">New here? Search a Canadian location, inspect risk and satellite observations, or ask Ash for a guided tour. Risk scores are available only for monitored areas.</p><div className="ew-home-actions"><button type="button" className="ew-secondary-action" onClick={() => window.dispatchEvent(new Event("emberwatch:guide"))}>How to use EmberWatch · Ask Ash</button><button type="button" onClick={() => navigateTo("explore")}>Explore wildfire map <span aria-hidden="true">↗</span></button><button type="button" className="ew-secondary-action" onClick={() => navigateTo("forecast")}>Explore ML outlook <span aria-hidden="true">→</span></button></div>
          <div className="ew-home-trust"><span><b>01</b> SATELLITE DETECTIONS</span><span><b>02</b> RISK ASSESSMENTS</span><span><b>03</b> EXPERIMENTAL ML</span></div>
          <p className="ew-home-caution">Research and educational prototype · Not an emergency alert or evacuation service</p>
        </div>
        <div className="ew-home-preview" aria-label="EmberWatch features">
          <div className="ew-home-visual" aria-hidden="true">
            <div className="ew-home-radar-sweep"/><div className="ew-home-radar-points"><i/><i/><i/><i/></div><div className="ew-home-fire-halo ew-home-fire-halo-outer"/><div className="ew-home-fire-halo ew-home-fire-halo-inner"/>
            <div className="ew-home-flame"><span className="ew-home-flame-back"/><span className="ew-home-flame-main"/><span className="ew-home-flame-core"/></div>
            <div className="ew-home-fire-sparks">{Array.from({length:16},(_,i)=><i key={i} style={{"--fire-x":`${(i*31+17)%100}%`,"--fire-delay":`${-i*.41}s`,"--fire-drift":`${(i%2?1:-1)*(12+i%5*9)}px`}} />)}</div>
            <span className="ew-home-visual-tag tag-left">SATELLITE DATA PIPELINE</span><span className="ew-home-visual-tag tag-right">FIRE / SIGNAL / INSIGHT</span>
          </div>
          <div className="ew-home-intelligence" aria-label="Current platform data">
            <div><span>MONITORED REGIONS</span><strong>{loading ? "—" : error ? "Unavailable" : riskAreas.length}</strong><small>{loading ? "Loading data…" : error ? "Data unavailable" : "Loaded from risk API"}</small></div>
            <div><span>SATELLITE OBSERVATIONS</span><strong>{detectionLoading ? "—" : detectionError ? "Unavailable" : (detectionResult?.detections?.length ?? 0)}</strong><small>{detectionLoading ? "Loading data…" : detectionError ? "Data unavailable" : "Loaded records, not active fires"}</small></div>
            <div><span>DATA STATUS</span><strong>{loading || detectionLoading ? "Loading" : error || detectionError ? "Partial" : "Loaded"}</strong><small>Check dates in Explore map</small></div>
          </div>
          <div className="ew-home-preview-heading"><div><p className="ew-overline">YOUR COMMAND CENTER</p><h2>Find the signal.</h2></div><span className="ew-home-preview-count">03 / TOOLS</span></div>
          <div className="ew-feature-tiles">
            <button type="button" onClick={() => navigateTo("explore")}><strong><span className="ew-home-tile-icon">⌖</span> Explore the map</strong><span>Navigate monitored regions and satellite hotspot observations.</span><span aria-hidden="true">↗</span></button>
            <button type="button" onClick={() => navigateTo("forecast")}><strong><span className="ew-home-tile-icon">✦</span> ML weather outlook</strong><span>Explore historical fire-day weather similarity across four days.</span><span aria-hidden="true">↗</span></button>
            <button type="button" onClick={() => navigateTo("learn")}><strong><span className="ew-home-tile-icon">◈</span> Understand risk</strong><span>Discover how risk scores, confidence and data freshness work.</span><span aria-hidden="true">↗</span></button>
          </div>
        </div>
      </section>}
            {page === "forecast" && <ForecastPage areas={riskAreas} />}
      {page === "lab" && <InvestigationLab areas={riskAreas} detections={detectionResult?.detections ?? []} onExplore={() => navigateTo("explore")} />}
      {page === "analytics" && <StakeholderAnalytics areas={riskAreas} detections={detectionResult?.detections ?? []} onExplore={() => navigateTo("explore")} />}
      {page === "learn" && <section className="ew-learn ew-risk-editorial" aria-label="Understanding wildfire risk">
        <div className="ew-risk-hero">
          <div className="ew-risk-sky" aria-hidden="true"><div className="ew-risk-sun" /><div className="ew-risk-mountain ew-risk-mountain-back" /><div className="ew-risk-mountain ew-risk-mountain-front" /><div className="ew-risk-forest" /></div>
          <button type="button" className="ew-text-back" onClick={() => navigateTo("home")}>← Back to home</button>
          <span className="ew-risk-kicker"><span className="ew-risk-kicker-dot" /> FIELD GUIDE / 001</span>
          <h1>READ THE <em>SIGNALS.</em><br />NOT JUST THE SCORE.</h1>
          <p>Wildfire data tells a story. Learn to separate environmental risk, satellite observations, and the uncertainty behind every number.</p>
          <button type="button" className="ew-risk-hero-link" onClick={() => document.getElementById("ew-risk-guide")?.scrollIntoView({ behavior:"smooth", block:"start" })}>Explore the field guide <span aria-hidden="true">↓</span></button>
          <span className="ew-risk-hero-index" aria-hidden="true">EMBERWATCH / RESEARCH NOTES</span>
        </div>
        <div id="ew-risk-guide" className="ew-risk-guide">
          <div className="ew-risk-section-heading"><span>01 — THE BIG PICTURE</span><h2>Three signals. <em>Three different meanings.</em></h2><p>They work together on the map, but they are not interchangeable.</p></div>
          <div className="ew-risk-story">
            <article className="ew-risk-story-card ew-risk-story-weather"><div className="ew-risk-card-top"><span>01 / ENVIRONMENT</span><span className="ew-risk-card-glyph" aria-hidden="true">☀</span></div><div className="ew-risk-weather-art" aria-hidden="true"><div className="ew-risk-weather-orbit" /><span>°</span><i /></div><div className="ew-risk-card-bottom"><h3>Environmental risk</h3><p>A provisional 0–100 model score based on available weather, terrain and nearby detection history. <strong>It is not a fire-spread forecast.</strong></p></div></article>
            <article className="ew-risk-story-card ew-risk-story-satellite"><div className="ew-risk-card-top"><span>02 / OBSERVATION</span><span className="ew-risk-card-glyph" aria-hidden="true">✦</span></div><div className="ew-risk-satellite-art" aria-hidden="true"><svg viewBox="0 0 240 140" role="img" aria-label="Satellite scanning the earth"><path d="M22 115 Q120 30 218 115" fill="none" stroke="#bd7150" strokeWidth="2"/><path d="M70 115 Q120 73 170 115" fill="none" stroke="#ffad67" strokeWidth="1.5" strokeDasharray="4 6"/><path d="M120 52 L91 113 L149 113Z" fill="#e77c3b" fillOpacity=".14" stroke="#d87948" strokeDasharray="4 5"/><g transform="translate(120 44) rotate(-27)"><rect x="-12" y="-12" width="24" height="24" rx="4" fill="#f9ba80"/><rect x="-53" y="-9" width="34" height="18" fill="#785a57" stroke="#f2ae79" strokeWidth="2"/><rect x="19" y="-9" width="34" height="18" fill="#785a57" stroke="#f2ae79" strokeWidth="2"/><path d="M0 12 V25" stroke="#f9ba80" strokeWidth="3"/></g><circle cx="120" cy="108" r="5" fill="#ffb16a"/></svg></div><div className="ew-risk-card-bottom"><h3>Satellite detections</h3><p>A hotspot is an observation of heat, <strong>not confirmation of a wildfire.</strong> Detection confidence describes that observation—not a region's risk.</p></div></article>
            <article className="ew-risk-story-card ew-risk-story-data"><div className="ew-risk-card-top"><span>03 / CONTEXT</span><span className="ew-risk-card-glyph" aria-hidden="true">◷</span></div><div className="ew-risk-data-art" aria-hidden="true"><span className="ew-risk-data-label">DATA TIMELINE</span><div className="ew-risk-data-track"><i /><i /><i /><i /><i /></div><div className="ew-risk-data-readout"><span>OBSERVED</span><span>≠</span><span>CURRENT</span></div></div><div className="ew-risk-card-bottom"><h3>Freshness &amp; gaps</h3><p>Older records and missing inputs change what you can conclude. <strong>Always check timestamps and warnings</strong> before using an assessment.</p></div></article>
          </div>
          <div className="ew-risk-section-heading ew-risk-second-heading"><span>02 — HOW TO INTERPRET</span><h2>A score is a <em>starting point.</em></h2><p>Read the label, then investigate the evidence behind it.</p></div>
          <div className="ew-risk-interpret"><div className="ew-risk-scale-panel"><span className="ew-risk-small-label">ENVIRONMENTAL RISK / 0–100</span><div className="ew-risk-scale"><div className="ew-risk-scale-low">LOW</div><div className="ew-risk-scale-medium">MODERATE</div><div className="ew-risk-scale-high">HIGH</div></div><div className="ew-risk-scale-ticks"><span>0</span><span>40</span><span>70</span><span>100</span></div><p>The color is a modeled category for a monitored area, not a live alert or an evacuation instruction.</p></div><aside className="ew-risk-note"><span>FIELD NOTE / IMPORTANT</span><h3>Confidence ≠ risk.</h3><p>A high-confidence satellite hotspot can appear near an area with a different environmental risk level. The two measures answer different questions.</p><span className="ew-risk-note-mark" aria-hidden="true">!</span></aside></div>
          <div className="ew-risk-end"><div><span>READY TO INVESTIGATE?</span><h2>Put the field guide to work.</h2><p>Explore monitored locations, inspect timestamps, and compare the signals yourself.</p></div><button type="button" className="ew-primary-action" onClick={() => navigateTo("explore")}>Explore monitored areas <span aria-hidden="true">↗</span></button></div>
          <div className="ew-risk-interactive-link"><span>TRY IT YOURSELF</span><h3>See how the signals change.</h3><p>Experiment with weather inputs, compare monitored areas, and replay satellite records in the Investigation Lab.</p><button type="button" className="ew-primary-action" onClick={() => navigateTo("lab")}>Open Investigation Lab ↗</button></div>
          <p className="ew-risk-disclaimer">Educational research prototype · Not an emergency alert service. For emergencies, follow official local authorities.</p>
        </div>
      </section>}
            <div className={page === "explore" ? "ew-explore-page" : "ew-page-hidden"}>
        <div className="ew-page-heading">
        <div>
        <span className="ew-eyebrow"><span className="ew-live-ember" aria-hidden="true" /> CANADA · WILDFIRE EXPLORER</span>
        <h1>
        {view === "dashboard" ? "Explore the map" : "Area assessment"}
        </h1>
        <p>
        {view === "dashboard" ? "Search for a place or tap a marker to see its risk." : "Risk assessment and environmental conditions"}
        </p>
        </div>
        </div>

      <div className="ew-dashboard-tools">
        <button type="button" className="ew-explore-lab-cta" onClick={() => navigateTo("lab")}>✦ Compare · Simulate · Replay <span aria-hidden="true">↗</span></button>
        <button type="button" className="ew-report-cta" aria-expanded={reporting} onClick={() => setReporting((open) => !open)}>{reporting ? "Close fire report" : "Report a fire"} <span aria-hidden="true">{reporting ? "×" : "↗"}</span></button>
        <span className="ew-report-disclaimer">For emergencies, call local emergency services.</span>
      </div>
      {reporting && <div className="ew-report-panel"><ReportFire onClose={() => setReporting(false)} /></div>}

      {loading && (
        <p>Loading wildfire risk data...</p>
      )}

      {error && (
        <p role="alert" style={{ color: "red" }}>
          Risk data unavailable: {error}{" "}
          <button type="button" aria-label="Try loading risk data again" onClick={retryRiskAreas}>
            Try again
          </button>
        </p>
      )}

      {warnings.map((warning) => (
        <p key={warning.code} role="status" className="ew-warning">
          Notice: {warning.message}
        </p>
      ))}

      {!loading && !error && riskAreas.length === 0 && (
        <p>No monitored areas were returned by the backend.</p>
      )}

      {detectionLoading && (
        <p role="status">Loading wildfire detections...</p>
      )}

      {detectionError && (
        <p role="alert" style={{ color: "red" }}>
          Detections unavailable: {detectionError}{" "}
          <button type="button" aria-label="Try loading detections again" onClick={retryDetections}>
            Try again
          </button>
        </p>
      )}

      <DataFreshness areas={riskAreas} detections={detectionResult?.detections} />
      <div className="ew-data-notes"><button type="button" className="ew-data-notes-toggle" aria-expanded={showDataNotes} onClick={() => setShowDataNotes((open) => !open)}>{showDataNotes ? "Hide data details −" : "Data dates & details +"}</button>{showDataNotes && <div className="ew-data-notes-content"><p>Satellite detections and risk scores are separate measurements. Satellite observations come from NASA FIRMS; weather inputs come from Open-Meteo. Review timestamps and data warnings above before interpreting the map.</p></div>}</div>

      {showDataNotes && detectionResult && !detectionLoading && (
        <div className="ew-data-summary" role="status">
          <span>{detectionSummary(detectionResult)}</span>
          {detectionResult.detections.length === 0 && <span>No wildfire detections available for the latest observations.</span>}
        </div>
      )}

      {detectionResult && !detectionLoading && (
        <HotspotDiscoveryPanel clusters={mlHotspotClusters} onViewGroup={(cluster) => {
          setPage("explore");
          setClusterZoomTarget({ latitude: cluster.latitude, longitude: cluster.longitude });
          setMapZoom(8);
        }} />
      )}

      {/* #49: a rendering error in the map or details panel is contained here, so the
          status messages, search and Report a fire stay usable. */}
      <ErrorBoundary label="map and details" resetKeys={[riskAreas, detectionResult]}>
      <details className="ew-quick-guide-disclosure" open><summary>Quick map guide · 3 steps</summary><section className="ew-quick-guide" aria-label="Quick map guide"><div><strong>1. Find a location</strong><span>Search a Canadian city or browse monitored areas.</span><button type="button" onClick={() => { setSearchExpanded(true); requestAnimationFrame(() => document.getElementById("ew-area-search")?.focus()); }}>Find a place</button></div><div><strong>2. Read the map</strong><span>Colored circles show modeled risk; flame icons show satellite heat observations, not confirmed fires.</span><button type="button" onClick={() => { setMapControlsOpen(true); setLegendOpen(true); requestAnimationFrame(() => document.querySelector(".ew-legend-disclosure summary")?.focus()); }}>Show map legend</button></div><div><strong>3. Understand the score</strong><span>Risk is a model score out of 100, not the probability of a wildfire.</span><button type="button" onClick={() => navigateTo("learn")}>Understand risk</button></div></section></details><div className="ew-workspace ew-map-first">
        <div className="ew-ember-field" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></div>
        <div className="ew-map-column"><div className="ew-map-title"><span className="ew-map-title-dot" /> MAP <span className="ew-map-title-caption">Explore locations and satellite observations</span></div><div className="ew-map-frame">
          <MapContainer
            center={[54.5, -119]}
            zoom={6}
            maxBounds={[[40, -143], [85, -50]]}
            maxBoundsViscosity={1}
            minZoom={3}
            style={{ height: "100%", width: "100%" }}
          >
            <RefreshMapLayout active={page === "explore"} hasSelection={Boolean(searchedPlace || selectedArea)} />
            <MapZoomObserver onZoom={setMapZoom} zoomTarget={clusterZoomTarget} />
            <FocusSelected area={searchedPlace ?? selectedArea} />
            {basemap === "standard" ? (
              <TileLayer
                key="standard-basemap"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                className="ew-inferno-tiles"
                maxZoom={19}
              />
            ) : (
              <TileLayer
                key="satellite-basemap"
                attribution='Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maxZoom={19}
              />
            )}
            {basemap === "hybrid" && (
              <TileLayer
                key="hybrid-labels"
                attribution='Labels &copy; Esri'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                maxZoom={19}
                zIndex={2}
              />
            )}



            {searchedPlace && <CircleMarker center={[searchedPlace.latitude, searchedPlace.longitude]} radius={11} pathOptions={{color:"#ffb36c",fillColor:"#ff7843",fillOpacity:0.8,weight:3}}><Tooltip permanent direction="top"><strong>{searchedPlace.name}</strong><br />Selected location</Tooltip></CircleMarker>}
            {/* Draw non-interactive risk zones below clickable area and detection markers. */}
            {mapLayer !== "detections" && showZones && riskAreas
              .filter((area) => Number.isFinite(area.latitude) && Number.isFinite(area.longitude))
              .map((area) => (
                <Circle
                  key={`zone-${area.id}`}
                  center={[area.latitude, area.longitude]}
                  radius={RISK_ZONE_RADIUS_M}
                  pathOptions={riskZoneStyle(area)}
                  interactive={false}
                />
              ))}

            {mapLayer !== "detections" && riskAreas.map((area) => {
              // Pixel-sized markers stay visible at country-wide zoom levels.
              const { radius, ...pathOptions } = riskAreaStyle(area, selectedArea?.id === area.id);

              return (
                <CircleMarker
                  key={area.id}
                  center={[area.latitude, area.longitude]}
                  radius={radius}
                  pathOptions={pathOptions}
                  eventHandlers={{
                    click: () => { 
                      selectArea(area);
                    },
                  }}
                >
                  <Tooltip permanent={selectedArea?.id === area.id} direction="top" offset={[0, -12]} className={selectedArea?.id === area.id ? "ew-selected-tooltip" : ""}>
                    <strong>{area.name ?? `Area ${area.id}`}</strong>{selectedArea?.id === area.id ? <><br />Risk: {riskStatusText(area)}{validRiskScore(area) ? ` · ${area.risk_score.toFixed(1)}/100` : ""}</> : `: ${riskStatusText(area)}`}
                  </Tooltip>
               </CircleMarker>  
             );
           })}
           
          {mapLayer !== "risk" && mapClusters.map((cluster) => {
            const detection = cluster.items[0];
            const clustered = cluster.items.length > 1;
            const icon = clustered ? divIcon({
              className: "ew-fire-cluster-wrap",
              html: `<span class="ew-fire-cluster" aria-hidden="true">🔥 <b>${cluster.items.length}</b></span>`,
              iconSize: [48, 36], iconAnchor: [24, 18],
            }) : fireMarkerIcon(detection.classification === "low_confidence");
            return (
              <Marker
                key={`detection-${cluster.key}`}
                position={[cluster.latitude, cluster.longitude]}
                icon={icon}
                title={clustered ? `${cluster.items.length} satellite observations` : `Satellite observation, ${detection.classification === "low_confidence" ? "low confidence" : "meets confidence threshold"}`}
                alt={clustered ? `${cluster.items.length} satellite observations` : "Satellite heat observation"}
                eventHandlers={{ click: () => {
                  if (clustered) { setClusterZoomTarget({ latitude: cluster.latitude, longitude: cluster.longitude }); setMapZoom(8); setSelectedDetection(null); return; }
                  setSelectedDetection(detection); setSelectedArea(null); setSearchedPlace(null);
                  setDetailsExpanded(false); setView("information"); setShowFullDetails(false);
                  if (window.matchMedia?.("(max-width: 860px)").matches) requestAnimationFrame(() => detailsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
                } }}
              >
                <Popup>
                  {clustered ? <><strong>{cluster.items.length} satellite observations</strong><p>Zoom in to see individual hotspots. These may be historical.</p></> : <>
                    <strong>{classificationLabel(detection)}</strong>
                    <p>Location: {formatCoordinates(detection.latitude, detection.longitude)}
                    <br />Detected: {formatDetectionTime(detection.timestamp)}
                    <br />Confidence: {formatConfidence(detection.confidence)}</p>
                    {!detection.meets_threshold && <p>Below the {detectionResult.threshold}% confidence threshold. Treat with caution.</p>}
                  </>}
                </Popup>
              </Marker>
            );
          })}
        </MapContainer></div>
        <div className={`ew-map-controls ${mapControlsOpen ? "ew-map-controls-open" : "ew-map-controls-collapsed"}`}><button type="button" className="ew-map-controls-toggle" aria-label={mapControlsOpen ? "Close map layers and legend" : "Open map layers and legend"} title={mapControlsOpen ? "Close map controls" : "Map layers and legend"} aria-expanded={mapControlsOpen} aria-controls={mapControlsOpen ? "ew-map-controls-content" : undefined} onClick={() => setMapControlsOpen((open) => !open)}><span aria-hidden="true" className="ew-map-controls-icon">☷</span>{mapControlsOpen && <span className="ew-map-controls-label">Map layers & legend</span>}<span aria-hidden="true" className="ew-map-controls-indicator">{mapControlsOpen ? "×" : ""}</span></button>{mapControlsOpen && <div id="ew-map-controls-content" className="ew-map-controls-content"><div className="ew-basemap-picker"><span className="ew-basemap-label">Map appearance</span><div className="ew-layer-switcher" role="group" aria-label="Map appearance">{[["standard", "Standard"], ["hybrid", "Satellite"]].map(([value, label]) => <button type="button" key={value} aria-pressed={basemap === value} onClick={() => setBasemap(value)}>{label}</button>)}</div></div><div className="ew-layer-switcher" role="group" aria-label="Map layers">{[["both", "Both"], ["risk", "Risk"], ["detections", "Detections"]].map(([value, label]) => <button type="button" key={value} aria-pressed={mapLayer === value} onClick={() => setMapLayer(value)}>{label}</button>)}</div><label className="ew-zone-toggle">
          <input
            type="checkbox"
            checked={showZones}
            onChange={(event) => setShowZones(event.target.checked)}
          />{" "}
          Show 50 km risk zones
        </label>
        <details className="ew-legend-disclosure" open={legendOpen}><summary onClick={(event) => { event.preventDefault(); setLegendOpen((open) => !open); }}>Map legend</summary><RiskLegend /></details>
        <details className="ew-map-help"><summary>Map information</summary><p aria-label="Risk zone legend">Shaded risk zones represent the 50 km modeled footprint, not predicted fire spread.</p><p aria-label="Detection marker legend">Flame icons mark satellite detections: bright flame = meets confidence threshold; faded flame = low confidence. Detection confidence reflects the observation, not the environmental wildfire risk score.</p><p>Dashed outlines indicate incomplete inputs. Satellite hotspots are not confirmed wildfires.</p></details>
        </div>}</div></div>
        <div className="ew-map-side-window" aria-label="Location search and details">
        <aside className={`ew-side-panel ${selectedArea || selectedDetection || searchedPlace ? "ew-has-selection" : ""} ${detailsExpanded ? "ew-sheet-expanded" : ""}`}>
          <div className="ew-panel-top">{(selectedArea || selectedDetection || searchedPlace) && <button type="button" className="ew-clear-selection" onClick={() => { setSelectedArea(null); setSelectedDetection(null); setSearchedPlace(null); setSearch(""); setPlaceMatches([]); setSuggestionIndex(-1); setShowFullDetails(false); setView("dashboard"); }}>Clear current selection</button>}<button type="button" className="ew-search-collapse" aria-expanded={searchExpanded} onClick={() => setSearchExpanded((v) => !v)}>{searchExpanded ? "− Hide search" : "⌕ Search places"}</button><div className={searchExpanded ? "ew-search-body" : "ew-search-body ew-search-body-hidden"}>
          <div className="ew-locations-heading"><h2>Find a place</h2><span className="ew-section-meta">Canada</span></div>
          <label className="ew-search-label" htmlFor="ew-area-search">Search across Canada</label><p className="ew-search-hint">Select a suggestion or monitored area to see its available evidence. Unmonitored places do not have a modeled risk score.</p>
          <input id="ew-area-search" type="search" role="combobox" aria-label="Search Canadian locations" aria-autocomplete="list" aria-expanded={placeMatches.length > 0} aria-controls={placeMatches.length ? "ew-place-suggestions" : undefined} aria-activedescendant={placeMatches[suggestionIndex] ? `ew-place-${placeMatches[suggestionIndex].id}` : undefined} placeholder="Search anywhere in Canada..." value={search} onChange={(event) => { setSearch(event.target.value); setSuggestionIndex(-1); setShowAreaList(true); setSearchedPlace(null); if (view !== "dashboard") setView("dashboard"); }} onKeyDown={(event) => { if (event.key === "Escape") { setPlaceMatches([]); setSuggestionIndex(-1); } else if (["ArrowDown", "ArrowUp"].includes(event.key) && placeMatches.length) { event.preventDefault(); setSuggestionIndex(i => event.key === "ArrowDown" ? (i + 1) % placeMatches.length : (i <= 0 ? placeMatches.length - 1 : i - 1)); } else if (event.key === "Enter") { event.preventDefault(); if (placeMatches.length > 0) choosePlace(placeMatches[suggestionIndex] ?? placeMatches[0]); else if (filteredAreas.length > 0) selectArea(filteredAreas[0]); setSuggestionIndex(-1); } }} />
          {placeLoading && <p className="ew-search-count" role="status">Finding places...</p>}
          {placeError && <p className="ew-search-count" role="status">{placeError} <button type="button" onClick={() => setPlaceRetry(n => n + 1)}>Retry search</button></p>}
          {placeMatches.length > 0 && <div id="ew-place-suggestions" className="ew-place-suggestions" role="listbox" aria-label="Canadian place suggestions">{placeMatches.map((place) => <button type="button" role="option" id={`ew-place-${place.id}`} aria-selected={placeMatches[suggestionIndex]?.id === place.id} key={place.id} onClick={() => choosePlace(place)}>{place.name}{place.admin1 ? `, ${place.admin1}` : ""}<span>↗</span></button>)}</div>}
          {search.trim() && !placeLoading && placeMatches.length === 0 && !placeError && <p className="ew-search-count">Choose a monitored area below, or try another Canadian place name.</p>}
          <button type="button" className="ew-area-list-toggle" aria-expanded={showAreaList} onClick={() => setShowAreaList((open) => !open)}>{showAreaList ? "Hide monitored areas" : `Browse ${riskAreas.length} monitored areas`} <span aria-hidden="true">{showAreaList ? "−" : "+"}</span></button>
          {(showAreaList) && <nav className="ew-area-list" aria-label="Monitored areas">
          {filteredAreas.map((area) => <button type="button" aria-pressed={selectedArea?.id === area.id} className={`ew-area-row ${selectedArea?.id === area.id ? "is-selected" : ""}`} key={area.id} onClick={() => selectArea(area)}>
          <span className="ew-area-name">
          {area.name ?? `Area ${area.id}`}
          </span>
          <span className={`ew-risk-tag ew-risk-${(validRiskScore(area) ? area.risk_level : "unavailable").toLowerCase()}`}>
          {validRiskScore(area) ? area.risk_level : "N/A"}
          </span>
          <span aria-hidden="true">›</span>
          </button>)}{filteredAreas.length === 0 && <p className="ew-empty-search">No matching monitored areas.</p>}
          </nav>}
          <details className="ew-search-footnote"><summary>Where does the information come from?</summary><p>Search uses Open-Meteo geocoding for Canadian places. Model risk scores are only available for monitored areas; other locations show nearby detections from the loaded dataset, not a new risk estimate.</p></details>
          </div></div>
          {searchedPlace && <section className="ew-searched-place" aria-label="Searched place fire information"><h2>{searchedPlace.name}</h2><p>Location: {searchedPlace.latitude.toFixed(3)}, {searchedPlace.longitude.toFixed(3)}</p><p><strong>Risk score: Not available</strong> — this location is outside the currently monitored risk assessments.</p><p><strong>{nearbyDetections.length} nearby satellite detections</strong> within 50 km in the loaded records (up to 200 latest records nationwide).</p><p>These records may be historical and are not a live fire status. No nearby records does not mean no fires.</p><button type="button" onClick={() => { setSearchedPlace(null); setSearch(""); }}>Clear location</button></section>}
          <div ref={detailsRef} tabIndex={-1} className="ew-detail-panel" aria-label="Area details">{(selectedArea || selectedDetection || searchedPlace) && <button type="button" className="ew-sheet-handle" aria-expanded={detailsExpanded} onClick={() => setDetailsExpanded((v) => !v)}>{detailsExpanded ? "Show less −" : "Expand details +"}</button>}
          {selectedDetection ? (
            <section className="ew-detection-details" aria-label="Satellite detection details">
              <div className="ew-detail-heading"><div><span className="ew-overline">SATELLITE FIRE OBSERVATION</span><h2>🔥 {classificationLabel(selectedDetection)}</h2></div><button type="button" className="ew-back-button" onClick={() => { setSelectedDetection(null); setView("dashboard"); }}>← Back</button></div>
              <p><strong>Detected:</strong> {formatDetectionTime(selectedDetection.timestamp)}</p>
              <p><strong>Location:</strong> {formatCoordinates(selectedDetection.latitude, selectedDetection.longitude)}</p>
              <p><strong>Confidence:</strong> {formatConfidence(selectedDetection.confidence)}</p>
              <p>This is a satellite hotspot observation, not a confirmed wildfire or an environmental risk score.</p>
              <p>Environmental risk for this exact point is not calculated. Select a monitored risk circle to view its modeled risk score and factors.</p>
            </section>
          ) : !selectedArea ? (
            <>
              <h2>Pick a place</h2>
              <p>Tap a location to see its risk score and what goes into it.</p>
            </>
          ) : (
            <>
              <div className="ew-detail-heading"><div><span className="ew-overline">AREA ASSESSMENT</span><h2>{selectedArea.name ?? `Area ${selectedArea.id}`}</h2></div><button type="button" className="ew-back-button" onClick={() => { setSelectedArea(null); setShowFullDetails(false); setView("dashboard"); }}>← Back</button></div>

              <div className="ew-selection-actions"><button type="button" onClick={() => navigateTo("forecast")}>Explore available forecasts →</button><button type="button" onClick={() => navigateTo("lab")}>Compare areas →</button></div>
              <p className="ew-selection-disclaimer">Risk estimates are experimental. Satellite hotspots are observations, not confirmed fires or official emergency alerts.</p>
              {riskState(selectedArea) === "incomplete" && (
                <p role="status">
                  Some inputs are missing. This risk assessment is incomplete.
                </p>
              )}

              {riskState(selectedArea) === "unavailable" && (
                <p role="status">
                  {selectedArea.processing_error
                    ? "The risk score could not be calculated for this area. Try again later."
                    : "Not enough input data to calculate a risk score for this area."}
                </p>
              )}

              <div className="ew-metric-grid">
                <div className="ew-metric">
                <span>Risk level</span>
                <strong style={{color: riskColor(selectedArea)}}>
                {validRiskScore(selectedArea) ? selectedArea.risk_level : "Unavailable"}
                </strong>
                </div>
                <div className="ew-metric">
                <span>Risk score</span>
                <strong>
                {validRiskScore(selectedArea) ? `${selectedArea.risk_score.toFixed(1)} / 100` : "Unavailable"}
                </strong>
                </div>
                </div>
                {validRiskScore(selectedArea) && (
                  <div className="ew-score-bar" aria-hidden="true"><span style={{ width: `${selectedArea.risk_score}%`, background: riskColor(selectedArea) }} /></div>
                )}
                <hr />

              <div className="ew-assessment-summary">
                <p>{weatherObservedText(selectedArea)}</p>
                <p>{selectedArea.is_complete ? "All modeled inputs available" : `Partial assessment · ${Math.round((selectedArea.coverage ?? 0) * 100)}% input coverage`}</p>
              </div>
              <details className="ew-factor-disclosure">
                <summary>Environmental conditions</summary>
                <div className="ew-factor-list">
                  {Object.entries(factorLabels).map(([key, label]) => {
                    const value = factors[key];
                    const available = value !== null && value !== undefined && Number.isFinite(value);
                    return <div className="ew-factor-row" key={key}><span>{label}:</span><strong>{available ? `${value}${factorUnits[key] ? ` ${factorUnits[key]}` : ""}` : "Unavailable"}</strong></div>;
                  })}
                </div>
                {selectedArea.missing_inputs?.length > 0 && <p>Missing inputs: {missingInputNames(selectedArea).join(", ")}</p>}
                <p>These environmental factors contribute to an experimental risk estimate, not a confirmed fire.</p>
              </details>

              <button type="button" className="ew-details-button" onClick={() => setShowFullDetails((open) => !open)} aria-expanded={showFullDetails}>{showFullDetails ? "← Back to Fire Information" : "View Risk Details →"}</button>
              {showFullDetails && <div className="ew-expanded-details"><h3>How the risk estimate is calculated</h3>
              <ul aria-label="Risk factor explanations">
                {explainFactors(selectedArea).map(({ key, weight, score, explanation }) => (
                  <li key={key}>
                    <strong>{factorLabels[key]} ({Math.round(weight * 100)}% base weight): </strong>
                    {score === null ? "Unavailable" : `${score.toFixed(1)} / 100`}. {explanation}
                  </li>
                ))}
              </ul>
              <p>Model: {selectedArea.model_version ?? "Unavailable"}. Factor scores and weights are provisional; this is not a validated real-time fire forecast.</p>

              </div>}<button type="button" className="ew-clear-selection" onClick={() => { setSelectedArea(null); setShowFullDetails(false); setView("dashboard"); }}>Clear selection</button>
            </>
          )}
        </div></aside></div>
      </div>
      </ErrorBoundary>
      </div></main>
      <AshDetective areas={riskAreas} detections={detectionResult?.detections ?? []} selectedArea={selectedArea} searchedPlace={searchedPlace} currentPage={page} />
    </div>
  );
}

// #49: last-resort boundary for errors outside the map/details section (for
// example a risk record the API layer did not catch), so the page is never blank.
// The map and details have their own boundary inside AppContent.
function App() {
  return (
    <ErrorBoundary label="page" note="Reloading the page may help.">
      <AppContent />
    </ErrorBoundary>
  );
}

export default App;
