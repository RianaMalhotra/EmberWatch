
import { useEffect, useState } from "react";
import { fetchRiskAreas } from "./services/riskApi";
import { MapContainer, TileLayer, Circle, Popup } from "react-leaflet";
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
  const [selectedArea, setSelectedArea] = useState(null);

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
                eventHandlers={{
                  click: () => setSelectedArea(area),
              }}
            >
              <Popup>
                <strong>
                  {area.name}
                </strong>

                <p>
                  <strong>Wildfire Risk:</strong>{" "}
                  {area.risk_level ?? "Unavailable"}
                  <br />
                  <strong>Risk Score:</strong>{" "}
                  {area.risk_score !== null
                    ? `${area.risk_score.toFixed(1)} / 100`
                    : "Unavailable"}
                </p>

                <p>
                  <strong>Temperature:</strong>{" "}
                  {area.environmental_factors.temperature_c ?? "Unavailable"} °C
                  <br />

                  <strong>Humidity:</strong>{" "}
                  {area.environmental_factors.relative_humidity_pct ?? "Unavailable"} %
                  <br />

                  <strong>Wind:</strong>{" "}
                  {area.environmental_factors.wind_speed_kmh ?? "Unavailable"} km/h
                  <br />

                  <strong>Precipitation:</strong>{" "}
                  {area.environmental_factors.precipitation_mm ?? "Unavailable"} mm
                  <br />

                  <strong>Vegetation Index:</strong>{" "}
                  {area.environmental_factors.vegetation_index ?? "Unavailable"}
                  <br />

                  <strong>Slope:</strong>{" "}
                  {area.environmental_factors.slope_deg ?? "Unavailable"}°
                  <br />

                  <strong>Nearby Detections:</strong>{" "}
                  {area.environmental_factors.nearby_detections ?? "Unavailable"}
                </p>

                {!area.is_complete && (
                  <p>
                    <strong>Unavailable data:</strong>{" "}
                    {area.missing_inputs.join(", ")}
                  </p>
                )}
              </Popup>
            </Circle>
          );
        })}
      </MapContainer>
    </div>
  );
}

export default App;
