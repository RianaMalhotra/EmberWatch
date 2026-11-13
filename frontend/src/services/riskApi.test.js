import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchRiskAreas } from "./riskApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRiskAreas", () => {
  it("returns risk data when the API request succeeds", async () => {
    const mockResponse = {
      status: "success",
      source: "supabase",
      data: [
        {
          id: 1,
          name: "Toronto Test Area",
          latitude: 43.6532,
          longitude: -79.3832,
          risk_score: 75,
          risk_level: "HIGH",
          environmental_factors: {
            temperature_c: 32,
            relative_humidity_pct: 25,
          },
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRiskAreas();

    expect(result).toEqual(mockResponse);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/risk-areas");
  });

  it("throws an error when the server returns an unsuccessful status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );

    await expect(fetchRiskAreas()).rejects.toThrow(
      "Failed to fetch risk data: 503",
    );
  });

  it("throws an error when the response data is not an array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: "success",
          source: "supabase",
          data: {},
        }),
      }),
    );

    await expect(fetchRiskAreas()).rejects.toThrow(
      "Invalid risk data received",
    );
  });

  it("throws an error when the network request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );

    await expect(fetchRiskAreas()).rejects.toThrow("Network error");
  });
});


describe("Sprint 4 risk response contract (#63)", () => {
  it("accepts a valid empty risk-area response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ status: "success", source: "database", data: [] }),
    }));
    const result = await fetchRiskAreas();
    expect(result.data).toEqual([]);
  });

  it.each([null, {}, { data: null }, { data: "invalid" }])(
    "rejects malformed risk-area envelopes: %j",
    async (payload) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true, json: async () => payload,
      }));
      await expect(fetchRiskAreas()).rejects.toThrow("Invalid risk data received");
    },
  );
});
