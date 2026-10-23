
import { useEffect, useState } from "react";
import { fetchRiskAreas } from "./services/riskApi";
import ReportFire from "./components/ReportFire";
import { fetchDetections } from "./services/detectionApi";
import {
  classificationLabel,
  detectionStyle,
  detectionSummary,
  formatConfidence,
  formatCoordinates,
  formatDetectionTime,
} from "./utils/detectionFormat";
import { MapContainer, TileLayer, Circle, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const riskColors = {
  HIGH: "red",
  MODERATE: "orange",
  LOW: "green",
};

const factorLabels = {
  temperature_c: "Temperature",
  relative_humidity_pct: "Relative Humidity",
  wind_speed_kmh: "Wind Speed",
  precipitation_mm: "Precipitation",
  vegetation_index: "Vegetation Index",
  slope_deg: "Slope",
  nearby_detections: "Nearby Fire Detections",
};

const factorUnits = {
  temperature_c: "°C",
  relative_humidity_pct: "%",
  wind_speed_kmh: "km/h",
  precipitation_mm: "mm",
  slope_deg: "°",
};

function App() {
  const [riskAreas, setRiskAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dataSource, setDataSource] = useState(null);
  const [selectedArea, setSelectedArea] = useState(null);
  const [detectionResult, setDetectionResult] = useState(null);
  const [detectionError, setDetectionError] = useState(null);
  const [reporting, setReporting] = useState(false); // #51 Report a Fire panel

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
        setDetectionError(err.message || "Unable to load wildfire detections.");
      }
    }

    loadDetections();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadRiskAreas() {
      try {
        const result = await fetchRiskAreas();

        if (!active) return;

        setRiskAreas(result.data);
        setDataSource(result.source);
        setError(null);
      } catch (err) {
        if (!active) return;

        setRiskAreas([]);
        setError(err.message || "Unable to load wildfire risk data.");
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
  }, []);

  const factors = selectedArea?.environmental_factors ?? {};

  return (
    <div>
      <h1>Wildfire Early Detection & Risk Assessment</h1>

      {/* #51: public fire reports. Not an emergency service. */}
      {reporting ? (
        <ReportFire onClose={() => setReporting(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setReporting(true)}
          style={{ background: "#C2410C", color: "#fff", border: 0, borderRadius: 8, padding: "10px 16px", fontWeight: 600, marginBottom: 8 }}
        >
          Report a Fire
        </button>
      )}

      {loading && (
        <p>Loading wildfire risk data...</p>
      )}

      {error && (
        <p role="alert" style={{ color: "red" }}>
          Risk data unavailable: {error}
        </p>
      )}

      {dataSource === "mock" && !error && (
        <p>Demo data — not live wildfire risk</p>
      )}

      {!loading && !error && riskAreas.length === 0 && (
        <p>No monitored areas were returned by the backend.</p>
      )}

      {detectionError && (
        <p role="alert" style={{ color: "red" }}>
          Detections unavailable: {detectionError}
        </p>
      )}

      {detectionResult && (
        <p>{detectionSummary(detectionResult)}</p>
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

            {riskAreas.map((area) => {
              const color = riskColors[area.risk_level] || "gray";

              return (
                <Circle
                  key={area.id}
                  center={[area.latitude, area.longitude]}
                  radius={12000}
                  pathOptions={{
                    color: color,
                    fillColor: color,
                    fillOpacity: selectedArea?.id === area.id ? 0.8 : 0.5,
                    weight: selectedArea?.id === area.id ? 4 : 2,
                  }}
                  eventHandlers={{
                    click: () => { 
                      setSelectedArea(area);
                    },
                  }}
                >
                {dataSource === "mock" && (
                  <Popup>Demo data — not live wildfire risk</Popup>
                )} 
               </Circle>  
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
                  color: riskColors[selectedArea.risk_level] || "gray",
                }}
              >
                Risk: {selectedArea.risk_level ?? "Unavailable"}
              </h3>

              <p>
                <strong>Risk Score: </strong>
                {typeof selectedArea.risk_score === "number"
                  ? `${selectedArea.risk_score.toFixed(1)} / 100`
                  : "Unavailable"}
              </p>

              {selectedArea.is_complete === false && (
                <p role="status">
                  Some inputs are missing. This risk assessment is incomplete.
                </p>
              )}

              <hr />

              <h3>Environmental Factors</h3>

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

              {selectedArea.missing_inputs?.length > 0 && (
                <p>
                  <strong>Missing inputs: </strong>
                  {selectedArea.missing_inputs.join(", ")}
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
