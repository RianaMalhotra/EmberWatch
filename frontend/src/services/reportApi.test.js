import { afterEach, describe, expect, it, vi } from "vitest";
import { parseReportResponse, reportsEnabled, submitReport } from "./reportApi";

afterEach(() => vi.unstubAllGlobals());

const OK_BODY = { status: "success", data: { id: 7, review_status: "unverified" } };

function respond(body, { ok = true, status = 201 } = {}) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => body });
}

describe("submitReport", () => {
  it("POSTs JSON to /api/reports and returns the stored id", async () => {
    const fetchMock = respond(OK_BODY);
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitReport({ observed_type: "smoke" })).resolves.toEqual({ id: 7, reviewStatus: "unverified" });
    expect(fetchMock).toHaveBeenCalledWith("/api/reports", expect.objectContaining({
      method: "POST", body: JSON.stringify({ observed_type: "smoke" }),
    }));
  });

  it("gives a clear message when the server rejects or cannot be reached", async () => {
    vi.stubGlobal("fetch", respond(null, { ok: false, status: 404 }));
    await expect(submitReport({})).rejects.toThrow("error 404");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(submitReport({})).rejects.toThrow("Could not reach the server");
  });

  it("does not report success when a 2xx reply is empty or not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError(); } }));
    await expect(submitReport({})).rejects.toThrow("could not be confirmed");
  });
});

describe("parseReportResponse (#52 contract)", () => {
  it("accepts the expected success shape", () => {
    expect(parseReportResponse(OK_BODY)).toEqual({ id: 7, reviewStatus: "unverified" });
  });

  it.each([
    ["no body", null],
    ["empty object", {}],
    ["error status", { status: "error", data: { id: 7, review_status: "unverified" } }],
    ["missing data", { status: "success" }],
    ["missing id", { status: "success", data: { review_status: "unverified" } }],
    ["id is text", { status: "success", data: { id: "7", review_status: "unverified" } }],
    ["id is zero", { status: "success", data: { id: 0, review_status: "unverified" } }],
    ["missing review status", { status: "success", data: { id: 7 } }],
    ["already verified", { status: "success", data: { id: 7, review_status: "confirmed" } }],
  ])("rejects %s instead of defaulting to unverified", (_, body) => {
    expect(() => parseReportResponse(body)).toThrow("could not be confirmed");
  });
});

describe("reportsEnabled", () => {
  it.each([["true", true], [" TRUE ", true], ["false", false], ["", false], [undefined, false], ["1", false]])(
    "VITE_ENABLE_REPORTS=%j -> %s", (flag, expected) => {
      expect(reportsEnabled(flag)).toBe(expected);
    },
  );
});
