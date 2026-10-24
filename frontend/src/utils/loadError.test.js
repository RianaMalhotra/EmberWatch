import { describe, expect, it } from "vitest";
import { RequestTimeoutError } from "../services/requestHelpers.js";
import { describeLoadError } from "./loadError.js";

// #25/#26: what the person sees when loading data fails.

describe("describeLoadError", () => {
  it("explains a timeout", () => {
    expect(describeLoadError(new RequestTimeoutError(15000))).toBe(
      "The server took too long to respond.",
    );
  });

  it("explains an unreachable server (fetch rejects with a TypeError)", () => {
    expect(describeLoadError(new TypeError("Failed to fetch"))).toMatch(
      /Can't reach the server/,
    );
  });

  it("explains a 503 from the backend as a temporary outage", () => {
    expect(describeLoadError(new Error("Failed to fetch risk data: 503"))).toBe(
      "The data service is temporarily unavailable.",
    );
  });

  it("mentions the status for other server errors", () => {
    expect(describeLoadError(new Error("Failed to fetch detections: 500"))).toBe(
      "The server ran into a problem (500).",
    );
  });

  it("passes other messages through unchanged", () => {
    expect(describeLoadError(new Error("Invalid risk data received"))).toBe(
      "Invalid risk data received",
    );
    expect(describeLoadError(new Error("Failed to fetch risk data: 404"))).toBe(
      "Failed to fetch risk data: 404",
    );
  });

  it("uses the fallback when there is no message", () => {
    expect(describeLoadError(new Error(""), "Unable to load.")).toBe("Unable to load.");
    expect(describeLoadError(undefined, "Unable to load.")).toBe("Unable to load.");
  });
});
