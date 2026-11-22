import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fetchDetections } from "./detectionApi.js";
import { detectionPeriod } from "../utils/dataFreshness.js";
import { isDisplayableDetection } from "../utils/detectionFormat.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("FIRMS ingestion -> Flask -> frontend contract", () => {
  it("renders the Flask-produced detection contract and flags historical data", async () => {
    const file = process.env.EMBERWATCH_CONTRACT_OUTPUT;
    if (!file) throw new Error("EMBERWATCH_CONTRACT_OUTPUT must point to generated Flask contract");
    const payload = JSON.parse(readFileSync(file, "utf8"));
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => payload }));
    const result = await fetchDetections();
    expect(result.detections).toHaveLength(2);
    expect(result.detections.every(isDisplayableDetection)).toBe(true);
    expect(result.counts.potential_wildfire).toBe(1);
    expect(result.counts.low_confidence).toBe(1);
    const freshness = detectionPeriod(result.detections, new Date("2026-11-22T12:00:00Z"), "UTC");
    expect(freshness.historical).toBe(true);
    expect(freshness.text).toMatch(/historical records, not current fires/);
  });
  it("does not show data when the API is unavailable", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 }));
    await expect(fetchDetections()).rejects.toThrow(/503/);
  });
});
