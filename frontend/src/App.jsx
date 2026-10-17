
import { useEffect, useState } from "react";
import { fetchRiskAreas } from "./services/riskApi";
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

function App() {
  const [riskAreas, setRiskAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dataSource, setDataSource] = useState(null);
  const [detectionResult, setDetectionResult] = useState(null);
  const [detectionError, setDetectionError] = useState(null);

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

  return (
    <div>
      <h1>Wildfire Early Detection & Risk Assessment</h1>

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

      {detectionError && (
        <p role="alert" style={{ color: "red" }}>
          Detections unavailable: {detectionError}
        </p>
      )}

      {detectionResult && (
        <p>{detectionSummary(detectionResult)}</p>
      )}

      <MapContainer
        center={[45.4, -77.5]}
        zoom={7}
        style={{ height: "80vh", width: "100%" }}
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
                fillOpacity: 0.5,
              }}
            >
              <Popup>
                <strong>
                  Wildfire Risk: {area.risk_level}
                </strong>

                <p>
                  Latitude: {area.latitude}
                  <br />
                  Longitude: {area.longitude}
                </p>

                {dataSource === "mock" && (
                  <p>Demo data — not live wildfire risk</p>
                )}
              </Popup>
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
                  Location:{" "}
                  {formatCoordinates(detection.latitude, detection.longitude)}
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
  );
}

export default App;
