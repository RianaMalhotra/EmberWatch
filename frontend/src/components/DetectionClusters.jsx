import { useEffect } from "react";
import { useMap } from "react-leaflet";

// Leaflet clustering without extra dependencies. Only groups points at country-scale zoom.
export function clusterDetections(detections, zoom) {
  if (zoom >= 7) return detections.map((d) => ({ key: String(d.id), items: [d], latitude: d.latitude, longitude: d.longitude }));
  const cell = zoom <= 3 ? 5 : zoom <= 4 ? 2.5 : zoom <= 5 ? 1.2 : 0.55;
  const groups = new Map();
  for (const d of detections) {
    if (!Number.isFinite(d.latitude) || !Number.isFinite(d.longitude)) continue;
    const key = `${Math.floor(d.latitude / cell)}:${Math.floor(d.longitude / cell)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  return Array.from(groups, ([key, items]) => ({
    key, items,
    latitude: items.reduce((sum, d) => sum + d.latitude, 0) / items.length,
    longitude: items.reduce((sum, d) => sum + d.longitude, 0) / items.length,
  }));
}

export function MapZoomObserver({ onZoom, zoomTarget }) {
  const map = useMap();
  useEffect(() => {
    if (zoomTarget && typeof map.flyTo === "function") map.flyTo([zoomTarget.latitude, zoomTarget.longitude], 8, { animate: true, duration: 0.5 });
  }, [map, zoomTarget]);
  useEffect(() => {
    if (typeof map.on !== "function") return;
    const update = () => onZoom(map.getZoom?.() ?? 7);
    map.on("zoomend", update);
    return () => map.off?.("zoomend", update);
  }, [map, onZoom]);
  return null;
}
