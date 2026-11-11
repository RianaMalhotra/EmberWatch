import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRiskAreas } from "./riskApi.js";
import { fetchDetections } from "./detectionApi.js";
import { RequestTimeoutError } from "./requestHelpers.js";

// #25 (data-source failures) and #26 (API/processing failures) as seen by the
// two API services. Server side: backend/tests/test_failure_handling.py.

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function stubFetch(impl) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const htmlErrorPage = () =>
  Promise.resolve({
    ok: true,
    json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
  });

describe.each([
  ["fetchRiskAreas", fetchRiskAreas, "Invalid risk data received"],
  ["fetchDetections", fetchDetections, "Invalid detection data received"],
])("%s failure handling", (_name, load, invalidMessage) => {
  it("reports a readable error when the response body is not JSON", async () => {
    stubFetch(htmlErrorPage);
    await expect(load()).rejects.toThrow(invalidMessage);
  });

  it("reports a readable error when the body is JSON null", async () => {
    stubFetch(() => Promise.resolve({ ok: true, json: () => Promise.resolve(null) }));
    await expect(load()).rejects.toThrow(invalidMessage);
  });

  it("gives up with a timeout error when the server never answers", async () => {
    vi.useFakeTimers();
    stubFetch(() => new Promise(() => {}));

    const result = load();
    const assertion = expect(result).rejects.toBeInstanceOf(RequestTimeoutError);

    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  });

  it("reports a network failure as the error fetch raised", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(load()).rejects.toBeInstanceOf(TypeError);
  });
});

describe("fetchRiskAreas warnings", () => {
  it("passes the API's warnings through to the page", async () => {
    const body = {
      status: "success",
      source: "supabase",
      data: [],
      warnings: [{ code: "history_unavailable", message: "Nearby fire history is temporarily unavailable." }],
    };
    stubFetch(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) }));

    const result = await fetchRiskAreas();

    expect(result.warnings).toEqual(body.warnings);
  });
});

// #49: malformed records inside an otherwise valid reply.
describe("fetchRiskAreas malformed records", () => {
  const good = { id: 1, name: "Kelowna", latitude: 49.9, longitude: -119.5, risk_score: 55, risk_level: "MODERATE" };
  const reply = (data, extra = {}) =>
    stubFetch(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "success", source: "supabase", data, ...extra }) }));

  it("leaves a clean reply untouched", async () => {
    reply([good]);
    const result = await fetchRiskAreas();
    expect(result.data).toEqual([good]);
    expect(result.warnings).toBeUndefined();
  });

  it.each([
    ["null", null],
    ["a string", "Kelowna"],
    ["an array", [1, 2]],
    ["no id", { ...good, id: undefined }],
    ["null coordinates", { ...good, latitude: null, longitude: null }],
    ["text coordinates", { ...good, latitude: "49.9" }],
    ["NaN coordinates", { ...good, longitude: NaN }],
    ["out-of-range latitude", { ...good, latitude: 123 }],
  ])("drops a record that is %s and says so", async (_label, bad) => {
    reply([good, bad, { ...good, id: 2 }]);

    const result = await fetchRiskAreas();

    expect(result.data.map((a) => a.id)).toEqual([1, 2]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "area_unreadable", count: 1 }),
    ]);
  });

  it("keeps the API's own warnings alongside the new one", async () => {
    reply([good, null], { warnings: [{ code: "history_unavailable", message: "History down." }] });

    const result = await fetchRiskAreas();

    expect(result.warnings.map((w) => w.code)).toEqual(["history_unavailable", "area_unreadable"]);
  });

  it("never turns a dropped record into a made-up area", async () => {
    reply([null, null]);
    const result = await fetchRiskAreas();
    expect(result.data).toEqual([]);
  });
});
