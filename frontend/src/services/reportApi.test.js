import { afterEach, describe, expect, it, vi } from "vitest";
import { submitReport } from "./reportApi";

afterEach(() => vi.unstubAllGlobals());

describe("submitReport", () => {
  it("POSTs JSON to /api/reports and returns the id and status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 7, status: "unverified" }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitReport({ observed_type: "smoke" })).resolves.toEqual({ id: 7, status: "unverified" });
    expect(fetchMock).toHaveBeenCalledWith("/api/reports", expect.objectContaining({
      method: "POST", body: JSON.stringify({ observed_type: "smoke" }),
    }));
  });

  it("gives a clear message when the server rejects or cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(submitReport({})).rejects.toThrow("error 404");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(submitReport({})).rejects.toThrow("Could not reach the server");
  });
});
