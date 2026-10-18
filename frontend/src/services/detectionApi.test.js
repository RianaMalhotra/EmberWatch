import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveApiBaseUrl } from "./apiConfig.js";
import { fetchDetections } from "./detectionApi.js";
import {
  classificationLabel,
  detectionStyle,
  detectionSummary,
  formatConfidence,
  formatCoordinates,
  formatDetectionTime,
  isDisplayableDetection,
  sanitizeDetections,
} from "../utils/detectionFormat.js";


// #18: the map shows location, timestamp and confidence for each detection
// returned by GET /api/detections (#17). Server side: backend/tests/test_detection_pipeline.py.
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const sample = {
  status: "success",
  source: "database",
  threshold: 20,
  detections: [
    {
      id: 1,
      latitude: 50.1,
      longitude: -120.3,
      timestamp: "2025-07-01T18:30:00Z",
      confidence: 80,
      classification: "potential_wildfire",
      meets_threshold: true,
    },
    {
      id: 2,
      latitude: 50.2,
      longitude: -120.4,
      timestamp: "2025-07-01T18:35:00Z",
      confidence: 10,
      classification: "low_confidence",
      meets_threshold: false,
    },
  ],
  gaps: [{ id: 3, reason: "Missing required field: latitude" }],
  counts: {
    total: 3,
    shown: 2,
    potential_wildfire: 1,
    low_confidence: 1,
    unavailable: 1,
  },
};

describe("detection API and formatting", () => {

  it("fetches detections from Flask with the requested limit", async () => {
    let requestedUrl;

    globalThis.fetch = async (url) => {
      requestedUrl = url;
      return { ok: true, json: async () => sample };
    };

    const result = await fetchDetections(50);

    expect(requestedUrl).toBe("/api/detections?limit=50");
    expect(result.detections).toEqual(sample.detections);
  });

  it("rejects unsuccessful responses instead of showing stale detections", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503 });

    await expect(fetchDetections()).rejects.toThrow(/503/);
  });

  it("rejects malformed detection data", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        status: "success",
        detections: null,
      }),
    });

    await expect(fetchDetections()).rejects.toThrow(
      /Invalid detection data/,
    );
  });

  it("propagates network failures", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    await expect(fetchDetections()).rejects.toThrow(/Failed to fetch/);
  });
});

it("#18 shows time with the zone labelled", () => {
  expect(
    formatDetectionTime("2025-07-01T18:30:00Z", "UTC"),
  ).toMatch(/Jul 1, 2025.*UTC/);

  expect(
    formatDetectionTime("2025-07-01T18:30:00Z", "America/Toronto"),
  ).toMatch(/2:30.*(EDT|GMT-4)/);
});

it("#18 reports unavailable time instead of inventing one", () => {
  expect(formatDetectionTime("not a date")).toBe("Time unavailable");
});

it("#18 formats location and confidence", () => {
  expect(formatCoordinates(50.1, -120.3)).toBe("50.100, -120.300");
  expect(formatConfidence(79.6)).toBe("80%");
  expect(formatConfidence(null)).toBe("Unavailable");
});

it("#18 low-confidence detections look different from likely ones", () => {
  const likely = detectionStyle(sample.detections[0]);
  const low = detectionStyle(sample.detections[1]);
  expect(likely.fillColor).not.toBe(low.fillColor);
  expect(low.fillOpacity).toBeLessThan(likely.fillOpacity);
  expect(classificationLabel(sample.detections[0])).toBe("Potential wildfire");
  expect(classificationLabel(sample.detections[1])).toBe("Low confidence detection");
});

it("#18 summary mentions detections that could not be shown", () => {
  const text = detectionSummary(sample);

  expect(text).toContain("2 detections shown");
  expect(text).toContain("1 potential wildfire");
  expect(text).toContain("1 low confidence");
  expect(text).toContain("20%");
  expect(text).toMatch(/1 could not be shown/);
});

// --- NaN / infinity (reviewer feedback) ---
it("#18 only finite, in-range detections are displayable", () => {
  const ok = sample.detections[0];
  expect(isDisplayableDetection(ok)).toBe(true);
  for (const bad of [
    { ...ok, latitude: NaN },
    { ...ok, longitude: Infinity },
    { ...ok, confidence: NaN },
    { ...ok, confidence: Infinity },
    { ...ok, confidence: 150 },
    { ...ok, latitude: 91 },
    { ...ok, latitude: null },
    { ...ok, confidence: "80" },
    null,
  ]) {
    expect(isDisplayableDetection(bad)).toBe(false);
  }
});

it("#18 drops invalid detections and counts them as unavailable", () => {
  const result = sanitizeDetections({
    ...sample,
    detections: [...sample.detections, { id: 4, latitude: NaN, longitude: -120, timestamp: "2025-07-01T18:30:00Z", confidence: 50, classification: "potential_wildfire" }],
  });
  expect(result.detections.length).toBe(2);
  expect(result.counts).toEqual({ total: 3, shown: 2, potential_wildfire: 1, low_confidence: 1, unavailable: 2 });
  expect(detectionSummary(result)).toMatch(/2 could not be shown/);
});

it("#18 leaves a clean response untouched", () => {
  expect(sanitizeDetections(sample)).toBe(sample);
});

it("#18 fetchDetections never returns a detection Leaflet could not draw", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ ...sample, detections: [...sample.detections, { ...sample.detections[0], id: 9, confidence: Infinity }] }),
  });
  const result = await fetchDetections();
  expect(result.detections.map((d) => d.id)).toEqual([1, 2]);
});

it("API base URL defaults to same-origin proxy and can be overridden", () => {
  expect(resolveApiBaseUrl(undefined)).toBe("");
  expect(resolveApiBaseUrl("")).toBe("");
  expect(resolveApiBaseUrl("   ")).toBe("");
  expect(resolveApiBaseUrl("https://api.example.com")).toBe("https://api.example.com");
  expect(resolveApiBaseUrl(" https://api.example.com/// ")).toBe("https://api.example.com");
});
