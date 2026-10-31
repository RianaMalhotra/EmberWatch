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
