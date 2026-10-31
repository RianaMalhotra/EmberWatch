
import { useEffect, useRef, useState } from "react";
import { fetchRiskAreas } from "./services/riskApi";
import { fetchDetections } from "./services/detectionApi";
import { describeLoadError } from "./utils/loadError";
import {
  classificationLabel,
  detectionStyle,
  detectionSummary,
  formatConfidence,
  formatCoordinates,
  formatDetectionTime,
} from "./utils/detectionFormat";
import { areaBounds, riskAreaStyle, riskStatusText } from "./utils/riskFormat";
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import RiskLegend from "./components/RiskLegend";
import AreaList from "./components/AreaList";
import AreaDetails from "./components/AreaDetails";
import "./dashboard.css";

// On narrow screens the details panel sits under the map, so after a tap we
// scroll to it; otherwise selecting an area looks like nothing happened.
const STACKED_LAYOUT = "(max-width: 860px)";

// Zoom the map to the monitored areas once they load (#68 areas span Canada).
function FitToAreas({ areas }) {
  const map = useMap();
  const points = areaBounds(areas);
  const key = points.map((p) => p.join(",")).join(";");

  useEffect(() => {
    if (points.length > 0) {
      map.fitBounds(points, { padding: [30, 30], maxZoom: 8 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);

  return null;
}

// Keep the selected area on screen, e.g. after choosing it from the list.
function FocusSelected({ area }) {
  const map = useMap();

  useEffect(() => {
    if (!area) return;
    const point = [area.latitude, area.longitude];
    if (!map.getBounds().contains(point)) {
      map.panTo(point);
    }
  }, [map, area]);

  return null;
}

function App() {
  const [riskAreas, setRiskAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dataSource, setDataSource] = useState(null);
  const [selectedArea, setSelectedArea] = useState(null);
  const [detectionResult, setDetectionResult] = useState(null);
  const [detectionError, setDetectionError] = useState(null);
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
        setDataSource(result.source);
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

  function retryRiskAreas() {
    setLoading(true);
    setError(null);
    setRiskAttempt((n) => n + 1);
  }

  function retryDetections() {
    setDetectionError(null);
    setDetectionAttempt((n) => n + 1);
  }

  const panelRef = useRef(null);

  function selectArea(area) {
    setSelectedArea(area);
    if (window.matchMedia?.(STACKED_LAYOUT).matches) {
      // Wait for the panel to render the new area before scrolling to it.
      requestAnimationFrame(() => {
        panelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
        panelRef.current?.focus?.({ preventScroll: true });
      });
    }
  }

  return (
    <div className="app">
      <h1>Wildfire Early Detection & Risk Assessment</h1>

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
        <p key={warning.code} role="status" style={{ color: "#92400e" }}>
          Notice: {warning.message}
        </p>
      ))}

      {dataSource === "mock" && !error && (
        <p>Demo data — not live wildfire risk</p>
      )}

      {!loading && !error && riskAreas.length === 0 && (
        <p>No monitored areas were returned by the backend.</p>
      )}

      {detectionError && (
        <p role="alert" style={{ color: "red" }}>
          Detections unavailable: {detectionError}{" "}
          <button type="button" aria-label="Try loading detections again" onClick={retryDetections}>
            Try again
          </button>
        </p>
      )}

      {detectionResult && (
        <p>{detectionSummary(detectionResult)}</p>
      )}

      <div className="dash">
        <div className="dash-map">
          <MapContainer
            className="dash-leaflet"
            center={[45.4, -77.5]}
            zoom={7}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <FitToAreas areas={riskAreas} />
            <FocusSelected area={selectedArea} />

            {riskAreas.map((area) => {
              // Pixel-sized markers stay visible at country-wide zoom levels.
              const { radius, ...pathOptions } = riskAreaStyle(area, selectedArea?.id === area.id);

              return (
                <CircleMarker
                  key={area.id}
                  center={[area.latitude, area.longitude]}
                  radius={radius}
                  pathOptions={pathOptions}
                  eventHandlers={{
                    click: () => selectArea(area),
                  }}
                >
                  <Tooltip>
                    {area.name ?? `Area ${area.id}`}: {riskStatusText(area)}
                  </Tooltip>
                {dataSource === "mock" && (
                  <Popup>Demo data — not live wildfire risk</Popup>
                )} 
               </CircleMarker>  
             );
           })}
           
          {detectionResult?.detections.map((detection) => {
            const { radius, ...pathOptions } = detectionStyle(detection);

            return (
              <CircleMarker
                key={`detection-${detection.id}`}
                center={[detection.latitude, detection.longitude]}
                radius={radius}
                pathOptions={pathOptions}
              >
                <Popup>
                  <strong>{classificationLabel(detection)}</strong>
                  <p>
                    Location: {formatCoordinates(detection.latitude, detection.longitude)}
                    <br />
                    Detected: {formatDetectionTime(detection.timestamp)}
                    <br />
                    Confidence: {formatConfidence(detection.confidence)}
                  </p>

                  {!detection.meets_threshold && (
                    <p>
                      Below the {detectionResult.threshold}% confidence
                      threshold. Treat with caution.
                    </p>
                  )}
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
          <RiskLegend />
        </div>

        <AreaDetails ref={panelRef} area={selectedArea} onClear={() => setSelectedArea(null)} />

        <AreaList areas={riskAreas} selectedId={selectedArea?.id} onSelect={selectArea} />
      </div>
    </div>
  );
}

export default App;
