
import { useEffect, useRef, useState } from "react";
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
import { clusterDetections, MapZoomObserver } from "./components/DetectionClusters";

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

function RefreshMapLayout({ active }) {
  const map = useMap();
  useEffect(() => {
    if (active) {
      map.invalidateSize?.();
      const frame = requestAnimationFrame(() => map.invalidateSize?.());
      return () => cancelAnimationFrame(frame);
    }
  }, [map, active]);
  return null;
}

function AppContent() {
  const [riskAreas, setRiskAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedArea, setSelectedArea] = useState(null);
  const [showZones, setShowZones] = useState(false);
  const [search, setSearch] = useState("");
  const [placeMatches, setPlaceMatches] = useState([]);
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
  const [mapLayer, setMapLayer] = useState("both");
  const [mapControlsOpen, setMapControlsOpen] = useState(true);
  const [mapZoom, setMapZoom] = useState(7);
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
    const timer = setTimeout(async () => {
      setPlaceLoading(true);
      setPlaceError("");
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
  }, [search, searchedPlace]);

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

  const nearbyDetections = searchedPlace && detectionResult?.detections
    ? detectionResult.detections.filter((d) => {
        const lat = (d.latitude - searchedPlace.latitude) * Math.PI / 180;
        const lon = (d.longitude - searchedPlace.longitude) * Math.PI / 180;
        const a = Math.sin(lat / 2) ** 2 + Math.cos(searchedPlace.latitude * Math.PI / 180) * Math.cos(d.latitude * Math.PI / 180) * Math.sin(lon / 2) ** 2;
        return 12742 * Math.asin(Math.min(1, Math.sqrt(a))) <= 50;
      })
    : [];

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
  const filteredAreas = sortAreasByRisk(riskAreas)
    .filter((area) => (area.name ?? `Area ${area.id}`).toLowerCase().includes(search.trim().toLowerCase()));
  function navigateTo(nextPage) {
    setPage(nextPage);
    setReporting(false);
    setMenuOpen(false);
  }

  function selectArea(area) {
    setPage("explore");
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
        <nav className="ew-top-nav" aria-label="Main navigation">
          <button type="button" aria-current={page === "home" ? "page" : undefined} onClick={() => navigateTo("home")}>Home</button>
          <button type="button" aria-current={page === "explore" ? "page" : undefined} onClick={() => navigateTo("explore")}>Explore map</button>
          <button type="button" aria-current={page === "learn" ? "page" : undefined} onClick={() => navigateTo("learn")}>Understand risk</button>
        </nav>
        <div className="ew-menu-wrap" ref={menuRef}>
          <button type="button" className="ew-menu-toggle" aria-label="More options" aria-expanded={menuOpen} aria-controls="ew-navigation" onClick={() => setMenuOpen((open) => !open)}>
            <span aria-hidden="true">☰</span><span>More</span>
          </button>
          {menuOpen && <nav id="ew-navigation" className="ew-navigation" aria-label="Map settings">
            <strong>More options</strong>
            <button type="button" onClick={() => { navigateTo("learn"); }}>How risk works</button>
            <button type="button" onClick={() => { setSelectedArea(null); setShowFullDetails(false); setView("dashboard"); setMenuOpen(false); }}>Reset map selection</button>
            <button type="button" onClick={() => { setPage("explore"); setReporting(true); setMenuOpen(false); }}>Report a Fire {REPORTS_ENABLED ? "" : "(preview)"}</button>
            <p>EmberWatch is an educational risk explorer, not an emergency alert service.</p>
          </nav>}
        </div>
        </header>
      <main className="ew-main">
      {page === "home" && <section className="ew-home" aria-label="EmberWatch home">
        <div className="ew-home-hero"><span className="ew-eyebrow">EXPLORE WILDFIRES IN CANADA</span><h1>See what’s<br /><em>happening.</em></h1><p>Curious about wildfire activity? Explore the map, check monitored areas, and see what the data tells us.</p><div className="ew-home-actions"><button type="button" onClick={() => setPage("explore")}>Explore the map <span aria-hidden="true">→</span></button><button type="button" className="ew-secondary-action" onClick={() => setPage("learn")}>How it works</button></div><p className="ew-home-caution">Educational prototype · Not an emergency alert or evacuation service</p></div>
        <div className="ew-home-preview" aria-label="Explore features"><div className="ew-home-orbit"><span>🔥</span></div><p className="ew-overline">WHAT CAN YOU DO?</p><h2>Start exploring.</h2><div className="ew-feature-tiles"><button type="button" onClick={() => setPage("explore")}><strong>Explore the map</strong><span>Search monitored regions and zoom to their risk assessments.</span><span aria-hidden="true">↗</span></button><button type="button" onClick={() => setPage("explore")}><strong>Spot fire activity</strong><span>Inspect satellite hotspots, timestamps and confidence.</span><span aria-hidden="true">↗</span></button><button type="button" onClick={() => setPage("learn")}><strong>Understand risk</strong><span>Learn what the scores mean and where data is missing.</span><span aria-hidden="true">↗</span></button></div></div>
      </section>}
      {page === "learn" && <section className="ew-learn" aria-label="Understanding wildfire risk"><button type="button" className="ew-text-back" onClick={() => setPage("home")}>← Back to home</button><span className="ew-eyebrow">DATA, NOT PREDICTIONS</span><h1>Know what you’re looking at.</h1><p className="ew-learn-intro">EmberWatch combines environmental observations and satellite detections. These are different kinds of information, with different limitations.</p><div className="ew-learn-grid"><article><span>01 / AREA RISK</span><h2>Environmental risk</h2><p>A provisional 0–100 model score derived from available weather, terrain and nearby detection history. It is not a forecast of where a fire will spread.</p></article><article><span>02 / SATELLITE SIGNAL</span><h2>Detection confidence</h2><p>Confidence describes an individual satellite hotspot observation, not the overall wildfire risk of a region. Hotspots are not necessarily confirmed wildfires.</p></article><article><span>03 / DATA QUALITY</span><h2>Freshness matters</h2><p>Older observations may not reflect current conditions. Check the dates, missing inputs and warnings before interpreting any risk assessment.</p></article></div><button type="button" className="ew-primary-action" onClick={() => setPage("explore")}>Explore monitored areas →</button><p className="ew-home-caution">For emergencies, follow official local authorities and emergency services.</p></section>}
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
      <div className="ew-data-notes"><button type="button" className="ew-data-notes-toggle" aria-expanded={showDataNotes} onClick={() => setShowDataNotes((open) => !open)}>{showDataNotes ? "Hide data details −" : "Data dates & details +"}</button>{showDataNotes && <div className="ew-data-notes-content"><p>Satellite detections and risk scores are separate measurements. Review timestamps and data warnings above before interpreting the map.</p></div>}</div>

      {showDataNotes && detectionResult && !detectionLoading && (
        <div className="ew-data-summary" role="status">
          <span>{detectionSummary(detectionResult)}</span>
          {detectionResult.detections.length === 0 && <span>No wildfire detections available for the latest observations.</span>}
        </div>
      )}

      <div className="ew-workspace ew-map-first">
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
            <RefreshMapLayout active={page === "explore"} />
            <MapZoomObserver onZoom={setMapZoom} zoomTarget={clusterZoomTarget} />
            <FocusSelected area={searchedPlace ?? selectedArea} />
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />



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
           
          {mapLayer !== "risk" && clusterDetections(detectionResult?.detections ?? [], mapZoom).map((cluster) => {
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
        <div className={`ew-map-controls ${mapControlsOpen ? "ew-map-controls-open" : "ew-map-controls-collapsed"}`}><button type="button" className="ew-map-controls-toggle" aria-label={mapControlsOpen ? "Close map layers and legend" : "Open map layers and legend"} title={mapControlsOpen ? "Close map controls" : "Map layers and legend"} aria-expanded={mapControlsOpen} aria-controls="ew-map-controls-content" onClick={() => setMapControlsOpen((open) => !open)}><span aria-hidden="true" className="ew-map-controls-icon">☷</span>{mapControlsOpen && <span className="ew-map-controls-label">Map layers & legend</span>}<span aria-hidden="true" className="ew-map-controls-indicator">{mapControlsOpen ? "×" : ""}</span></button><div id="ew-map-controls-content" className="ew-map-controls-content" hidden={!mapControlsOpen}><div className="ew-layer-switcher" role="group" aria-label="Map layers">{[["both", "Both"], ["risk", "Risk"], ["detections", "Detections"]].map(([value, label]) => <button type="button" key={value} aria-pressed={mapLayer === value} onClick={() => setMapLayer(value)}>{label}</button>)}</div><label className="ew-zone-toggle">
          <input
            type="checkbox"
            checked={showZones}
            onChange={(event) => setShowZones(event.target.checked)}
          />{" "}
          Show 50 km risk zones
        </label>
        <details className="ew-legend-disclosure" open><summary>Map legend</summary><RiskLegend /></details>
        <details className="ew-map-help"><summary>Map information</summary><p aria-label="Risk zone legend">Shaded risk zones represent the 50 km modeled footprint, not predicted fire spread.</p><p aria-label="Detection marker legend">Flame icons mark satellite detections: bright flame = meets confidence threshold; faded flame = low confidence. Detection confidence reflects the observation, not the environmental wildfire risk score.</p><p>Shaded 50 km circles represent modeled area risk, not predicted fire spread. Dashed outlines indicate incomplete inputs. Bright flame icons meet the satellite confidence threshold; faded flame icons do not. Detection confidence is not the same as wildfire risk.</p></details>
        </div></div></div>
        <div className="ew-map-side-window" aria-label="Location search and details">
        <aside className={`ew-side-panel ${selectedArea || selectedDetection || searchedPlace ? "ew-has-selection" : ""} ${detailsExpanded ? "ew-sheet-expanded" : ""}`}>
          <div className="ew-panel-top"><button type="button" className="ew-search-collapse" aria-expanded={searchExpanded} onClick={() => setSearchExpanded((v) => !v)}>{searchExpanded ? "− Hide search" : "⌕ Search places"}</button><div className={searchExpanded ? "ew-search-body" : "ew-search-body ew-search-body-hidden"}>
          <div className="ew-locations-heading"><h2>Find a place</h2><span className="ew-section-meta">Canada</span></div>
          <label className="ew-search-label" htmlFor="ew-area-search">Search across Canada</label>
          <input id="ew-area-search" type="search" role="combobox" aria-autocomplete="list" aria-expanded={placeMatches.length > 0} aria-controls="ew-place-suggestions" placeholder="Search anywhere in Canada..." value={search} onChange={(event) => { setSearch(event.target.value); setSearchedPlace(null); if (view !== "dashboard") setView("dashboard"); }} onKeyDown={(event) => { if (event.key === "Enter") { if (placeMatches.length > 0) choosePlace(placeMatches[0]); else if (filteredAreas.length > 0) selectArea(filteredAreas[0]); } }} />
          {placeLoading && <p className="ew-search-count" role="status">Finding places...</p>}
          {placeError && <p className="ew-search-count" role="status">{placeError}</p>}
          {placeMatches.length > 0 && <div id="ew-place-suggestions" className="ew-place-suggestions" role="listbox" aria-label="Canadian place suggestions">{placeMatches.map((place) => <button type="button" role="option" aria-selected={false} key={place.id} onClick={() => choosePlace(place)}>{place.name}{place.admin1 ? `, ${place.admin1}` : ""}<span>↗</span></button>)}</div>}
          {search.trim() && !placeLoading && placeMatches.length === 0 && !placeError && <p className="ew-search-count">Choose a monitored area below, or try another Canadian place name.</p>}
          <button type="button" className="ew-area-list-toggle" aria-expanded={showAreaList || Boolean(search.trim())} onClick={() => setShowAreaList((open) => !open)}>{showAreaList || search.trim() ? "Hide monitored areas" : `Browse ${riskAreas.length} monitored areas`} <span aria-hidden="true">{showAreaList || search.trim() ? "−" : "+"}</span></button>
          {(showAreaList || Boolean(search.trim())) && <nav className="ew-area-list" aria-label="Monitored areas">
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

              <button type="button" className="ew-details-button" onClick={() => {setShowFullDetails((v) => !v);setView((v) => v === "risk" ? "information" : "risk");}} aria-expanded={showFullDetails}>{showFullDetails ? "← Back to Fire Information" : "View Risk Details →"}</button>
              <div className={showFullDetails ? "ew-expanded-details" : "ew-collapsed-details"}><h3>How the risk estimate is calculated</h3>
              <ul aria-label="Risk factor explanations">
                {explainFactors(selectedArea).map(({ key, weight, score, explanation }) => (
                  <li key={key}>
                    <strong>{factorLabels[key]} ({Math.round(weight * 100)}% base weight): </strong>
                    {score === null ? "Unavailable" : `${score.toFixed(1)} / 100`}. {explanation}
                  </li>
                ))}
              </ul>
              <p>Model: {selectedArea.model_version ?? "Unavailable"}. Factor scores and weights are provisional; this is not a validated real-time fire forecast.</p>

              </div><button type="button" className="ew-clear-selection" onClick={() => { setSelectedArea(null); setShowFullDetails(false); setView("dashboard"); }}>Clear selection</button>
            </>
          )}
        </div></aside></div>
      </div></div></main>
      <AshDetective areas={riskAreas} detections={detectionResult?.detections ?? []} selectedArea={selectedArea} searchedPlace={searchedPlace} />
    </div>
  );
}

// #49: if something in the page throws while rendering (for example a risk
// record the API layer did not catch), show a recovery message with a Try again
// button instead of a blank page.
function App() {
  return (
    <ErrorBoundary label="page" note="Reloading the page may help.">
      <AppContent />
    </ErrorBoundary>
  );
}

export default App;
