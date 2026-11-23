/** Unsupervised DBSCAN on geodesic distance; no trained labels or prediction. */
const EARTH_KM = 6371.0088;
export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const lat = (b.latitude - a.latitude) * rad;
  const lon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(lon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Density-based spatial clustering of satellite hotspots (DBSCAN).
 * Noise is deliberately excluded; clusters are NOT confirmed fires.
 * Uses O(n²) distances, capped at the API's 1,000 detections.
 */
export function findHotspotClusters(detections, { radiusKm = 25, minPoints = 3 } = {}) {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || !Number.isInteger(minPoints) || minPoints < 2) {
    throw new RangeError("Invalid DBSCAN parameters");
  }
  const points = (Array.isArray(detections) ? detections : []).filter((d) =>
    d?.classification === "potential_wildfire" &&
    Number.isFinite(d.latitude) && Math.abs(d.latitude) <= 90 &&
    Number.isFinite(d.longitude) && Math.abs(d.longitude) <= 180
  ).slice(0, 1000);
  const labels = Array(points.length).fill(undefined);
  const neighbors = (i) => points.reduce((ids, p, j) => {
    if (distanceKm(points[i], p) <= radiusKm) ids.push(j);
    return ids;
  }, []);
  let clusterId = 0;
  for (let i = 0; i < points.length; i++) {
    if (labels[i] !== undefined) continue;
    const near = neighbors(i);
    if (near.length < minPoints) { labels[i] = -1; continue; }
    labels[i] = clusterId;
    const queue = [...near];
    const queued = new Set(queue);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const j = queue[cursor];
      if (labels[j] === -1) labels[j] = clusterId;
      if (labels[j] !== undefined) continue;
      labels[j] = clusterId;
      const next = neighbors(j);
      if (next.length >= minPoints) {
        for (const k of next) if (!queued.has(k)) { queued.add(k); queue.push(k); }
      }
    }
    clusterId++;
  }
  return Array.from({ length: clusterId }, (_, id) => {
    const members = points.filter((_, i) => labels[i] === id);
    return {
      id,
      count: members.length,
      latitude: members.reduce((sum, p) => sum + p.latitude, 0) / members.length,
      longitude: members.reduce((sum, p) => sum + p.longitude, 0) / members.length,
      latestTimestamp: members.map((p) => p.timestamp).filter(Boolean).sort().at(-1) ?? null,
    };
  }).sort((a, b) => b.count - a.count);
}
