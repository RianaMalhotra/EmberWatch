// #48: lightweight, opt-in timing for the map. Add ?perf=1 to the URL to log
// how long loading and interactions take in a real browser; add
// ?detections=1000 to load more detections (the API allows 1-1000).
// Results are printed to the console and kept in window.__mapPerf so they can
// be copied into docs/map-performance.md. Without ?perf=1 nothing is recorded.

function params() {
  try {
    return new URLSearchParams(globalThis.location?.search ?? "");
  } catch {
    return new URLSearchParams();
  }
}

export function perfEnabled() {
  return params().has("perf");
}

export const DEFAULT_DETECTION_LIMIT = 200;

export function detectionLimit() {
  const raw = Number(params().get("detections"));
  return Number.isInteger(raw) && raw >= 1 && raw <= 1000 ? raw : DEFAULT_DETECTION_LIMIT;
}

const started = new Map();

export function perfStart(name) {
  if (!perfEnabled()) return;
  started.set(name, performance.now());
}

// Call after React has committed the change. Waits two animation frames, so
// the time includes the browser drawing the result on screen.
export function perfEnd(name, details = {}) {
  if (!perfEnabled() || !started.has(name)) return;
  const begin = started.get(name);
  started.delete(name);
  const finish = () => {
    const entry = { name, ms: Math.round(performance.now() - begin), ...details };
    globalThis.__mapPerf = [...(globalThis.__mapPerf ?? []), entry];
    console.info(`[map-perf] ${name}: ${entry.ms} ms`, details);
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(finish));
  } else {
    finish();
  }
}
