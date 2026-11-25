import { formatDetectionTime } from "../utils/detectionFormat";

export default function HotspotDiscoveryPanel({ clusters, onViewGroup }) {
  return (
    <details className="ew-map-help" aria-label="ML hotspot discovery">
      <summary>ML hotspot discovery (DBSCAN) — {clusters.length} spatial groups</summary>
      <p>Unsupervised density-based clustering groups nearby satellite hotspots within 25 km (at least 3 observations). These are <strong>not confirmed fires or predictions</strong>; detections may be historical or delayed. Check timestamps.</p>
      {clusters.length === 0 ? <p>No dense hotspot groups in the currently loaded detections.</p> : (
        <ul>{clusters.slice(0, 8).map((cluster) => (
          <li key={cluster.id}>
            <button type="button" onClick={() => onViewGroup(cluster)}>
              View group ({cluster.count} detections) at {cluster.latitude.toFixed(2)}, {cluster.longitude.toFixed(2)}
            </button>
            {cluster.latestTimestamp && <span> · latest observation {formatDetectionTime(cluster.latestTimestamp)}</span>}
          </li>
        ))}</ul>
      )}
    </details>
  );
}
