import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { fetchRiskAreas } from "./riskApi.js";

// #22: the Leaflet heatmap consumes the data returned by this API helper.
// The server-side contract is also checked by backend/tests/test_sprint1_integration.py.
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("#22 fetches risk areas from Flask and preserves the demo source", async () => {
  const areas = [
    { id: 1, latitude: 45.42, longitude: -75.69, risk_level: "HIGH" },
    { id: 2, latitude: 45.6, longitude: -78.4, risk_level: "MODERATE" },
    { id: 3, latitude: 44.2, longitude: -79.1, risk_level: "LOW" },
  ];
  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ status: "success", source: "mock", data: areas }) };
  };
  const result = await fetchRiskAreas();
  assert.equal(requestedUrl, "/api/risk-areas");
  assert.deepEqual(result.data, areas);
  assert.equal(result.source, "mock");
});

test("#22 rejects unsuccessful API responses instead of showing stale risk", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(fetchRiskAreas(), /503/);
});

test("#22 rejects malformed risk-area data", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ status: "success", source: "mock", data: null }),
  });
  await assert.rejects(fetchRiskAreas(), /Invalid risk data/);
});

test("#22 propagates network failures", async () => {
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(fetchRiskAreas(), /Failed to fetch/);
});
