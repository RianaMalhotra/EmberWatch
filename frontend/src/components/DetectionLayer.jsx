import { memo, useMemo } from "react";
import { divIcon } from "leaflet";
import { Marker, Popup } from "react-leaflet";
import { clusterDetections } from "./DetectionClusters";
import {
  classificationLabel,
  formatConfidence,
  formatCoordinates,
  formatDetectionTime,
} from "../utils/detectionFormat";

// #48: satellite fire markers, moved out of App so they only update when
// something about them changes.
//
// Before: every App render (each letter typed in the search box, each area
// click) re-ran the clustering and created a brand-new divIcon object for every
// marker. react-leaflet sees a different `icon` and calls Leaflet's setIcon(),
// which deletes the marker's HTML element and builds a new one. With 1000
// detections, typing four letters rebuilt 5000 marker elements.
//
// Now: icons are created once and reused, clusters are only recomputed when
// the detections or the zoom level change, and memo() skips this whole layer
// when its props are unchanged.

const singleIcons = {
  likely: makeFireIcon(false),
  low: makeFireIcon(true),
};

function makeFireIcon(lowConfidence) {
  return divIcon({
    className: "ew-fire-marker-wrap",
    html: `<span class="ew-fire-marker ${lowConfidence ? "ew-fire-marker-low" : "ew-fire-marker-likely"}" aria-hidden="true">🔥</span>`,
    iconSize: [26, 30],
    iconAnchor: [13, 25],
    popupAnchor: [0, -23],
  });
}

function fireMarkerIcon(lowConfidence) {
  return lowConfidence ? singleIcons.low : singleIcons.likely;
}

const clusterIcons = new Map();

// One shared icon per cluster size (a handful of distinct sizes in practice).
function clusterIcon(size) {
  if (!clusterIcons.has(size)) {
    clusterIcons.set(size, divIcon({
      className: "ew-fire-cluster-wrap",
      html: `<span class="ew-fire-cluster" aria-hidden="true">🔥 <b>${size}</b></span>`,
      iconSize: [48, 36],
      iconAnchor: [24, 18],
    }));
  }
  return clusterIcons.get(size);
}

function DetectionLayer({ detections, threshold, zoom, onSelectDetection, onZoomToCluster }) {
  const clusters = useMemo(() => clusterDetections(detections ?? [], zoom), [detections, zoom]);

  return clusters.map((cluster) => {
    const detection = cluster.items[0];
    const clustered = cluster.items.length > 1;
    const icon = clustered
      ? clusterIcon(cluster.items.length)
      : fireMarkerIcon(detection.classification === "low_confidence");

    return (
      <Marker
        key={`detection-${cluster.key}`}
        position={[cluster.latitude, cluster.longitude]}
        icon={icon}
        eventHandlers={{
          click: () => (clustered ? onZoomToCluster(cluster) : onSelectDetection(detection)),
        }}
      >
        <Popup>
          {clustered ? (
            <>
              <strong>{cluster.items.length} satellite observations</strong>
              <p>Zoom in to see individual hotspots. These may be historical.</p>
            </>
          ) : (
            <>
              <strong>{classificationLabel(detection)}</strong>
              <p>
                Location: {formatCoordinates(detection.latitude, detection.longitude)}
                <br />Detected: {formatDetectionTime(detection.timestamp)}
                <br />Confidence: {formatConfidence(detection.confidence)}
              </p>
              {!detection.meets_threshold && (
                <p>Below the {threshold}% confidence threshold. Treat with caution.</p>
              )}
            </>
          )}
        </Popup>
      </Marker>
    );
  });
}

export default memo(DetectionLayer);
