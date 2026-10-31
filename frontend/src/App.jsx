
import { useEffect, useState } from "react";
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
import {
  FACTOR_LABELS as factorLabels,
  areaBounds,
  missingInputNames,
  riskAreaStyle,
  validRiskScore,
  riskColor,
  riskState,
  riskStatusText,
} from "./utils/riskFormat";
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { explainFactors } from "./utils/riskExplanation";

const factorUnits = {
  temperature_c: "°C",
  relative_humidity_pct: "%",
  wind_speed_kmh: "km/h",
  precipitation_mm: "mm",
  slope_deg: "°",
};

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

// #28: explains the three ways a risk area can be drawn.
function RiskLegend() {
  const swatch = (style) => ({
    display: "inline-block",
    width: 14,
    height: 14,
    borderRadius: "50%",
    marginRight: 6,
    verticalAlign: "middle",
    ...style,
  });

  return (
    <div aria-label="Map legend" style={{ fontSize: 14, marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap" }}>
      <span><span style={swatch({ background: "#dc2626" })} />High</span>
      <span><span style={swatch({ background: "#f97316" })} />Moderate</span>
      <span><span style={swatch({ background: "#16a34a" })} />Low</span>
      <span><span style={swatch({ border: "2px dashed #374151" })} />Dashed outline: incomplete (some inputs missing)</span>
      <span><span style={swatch({ background: "#e5e7eb", border: "2px dashed #6b7280" })} />Grey: risk unavailable (not enough data)</span>
    </div>
  );
}

function App() {
  const [riskAreas, setRiskAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dataSource, setDataSource] = useState(null);
  const [selectedArea, setSelectedArea] = useState(null);
  const [detectionResult, setDetectionResult] = useState(null);
  const [detectionError, setDetectionError] = useState(null);
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

  const factors = selectedArea?.environmental_factors ?? {};

  return (
    <div>
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

      {detectionResult && !detectionLoading && (
        <>
          <p>{detectionSummary(detectionResult)}</p>
          {detectionResult.detections.length === 0 && (
            <p role="status">No wildfire detections available for the latest observations.</p>
          )}
        </>
      )}

      <div 
        style={{
          display: "flex",
          gap: "16px",
          alignItems: "stretch",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 500px", minWidth: 0 }}>
          <MapContainer
            center={[45.4, -77.5]}
            zoom={7}
            style={{ height: "75vh", width: "100%" }}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <FitToAreas areas={riskAreas} />

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
                    click: () => { 
                      setSelectedArea(area);
                    },
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
        <p style={{ fontSize: 14 }} aria-label="Detection marker legend">
          Detection markers: solid red = meets confidence threshold; dashed grey = low confidence.
          Detection confidence reflects the observation, not the environmental wildfire risk score.
        </p>
      </div>
      
        <aside
          style={{
            flex: "0 1 300px",
            minWidth: "260px",
            padding: "16px",
            border: "1px solid #ccc",
            borderRadius: "8px",
            alignSelf: "flex-start",
          }}
        >
          {!selectedArea ? (
            <>
              <h2>Area Details</h2>
              <p>Click a colored circle on the map to view its risk assessment and environmental data.</p>
            </>
          ) : (
            <>
              <h2>{selectedArea.name ?? `Area ${selectedArea.id}`}</h2>

              <h3
                style={{
                  color: riskColor(selectedArea),
                }}
              >
                Risk: {validRiskScore(selectedArea) ? selectedArea.risk_level : "Unavailable"}
              </h3>

              <p>
                <strong>Risk Score: </strong>
                {validRiskScore(selectedArea)
                  ? `${selectedArea.risk_score.toFixed(1)} / 100`
                  : "Unavailable"}
              </p>

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

              <hr />

              <h3>Environmental Factors</h3>
              <p>These factors contribute to a weighted risk estimate, not a confirmed wildfire detection. Higher factor scores mean higher modeled risk; missing factors are excluded and the remaining weights are normalized.</p>

              {Object.entries(factorLabels).map(([key, label]) => {
                const value = factors[key];
                const available =
                  value !== null &&
                  value !== undefined &&
                  Number.isFinite(value);

                return (
                  <p key={key}>
                    <strong>{label}: </strong>
                    {available
                      ? `${value}${factorUnits[key] ? ` ${factorUnits[key]}` : ""}`
                      : "Unavailable"}
                  </p>
                );
              })}

              <h3>How the risk estimate is calculated</h3>
              <ul aria-label="Risk factor explanations">
                {explainFactors(selectedArea).map(({ key, weight, score, explanation }) => (
                  <li key={key}>
                    <strong>{factorLabels[key]} ({Math.round(weight * 100)}% base weight): </strong>
                    {score === null ? "Unavailable" : `${score.toFixed(1)} / 100`}. {explanation}
                  </li>
                ))}
              </ul>
              <p>Model: {selectedArea.model_version ?? "Unavailable"}. Factor scores and weights are provisional; this is not a validated real-time fire forecast.</p>

              {selectedArea.missing_inputs?.length > 0 && (
                <p>
                  <strong>Missing inputs: </strong>
                  {missingInputNames(selectedArea).join(", ")}
                </p>
              )}

              <p>
                <strong>Assessment complete: </strong>
                {selectedArea.is_complete ? "Yes" : "No"}
              </p>

              <button onClick={() => setSelectedArea(null)}>
                Clear selection
              </button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

export default App;
