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
  // #48: a lone detection keeps the same key (its id) at every zoom level, so
  // React keeps its Leaflet marker instead of removing and re-adding it each
  // time the zoom changes. Only real groups get a grid-cell key.
  return Array.from(groups, ([cellKey, items]) => ({
    key: items.length === 1 ? String(items[0].id) : `cluster-${cellKey}`,
    items,
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
