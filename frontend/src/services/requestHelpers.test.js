import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REQUEST_TIMEOUT_MS,
  RequestTimeoutError,
  withTimeout,
} from "./requestHelpers.js";

// #25: a slow backend must not leave the page waiting forever.

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the value when the request finishes in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
  });

  it("passes the original error through when the request fails first", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("Network error")), 1000),
    ).rejects.toThrow("Network error");
  });

  it("rejects with RequestTimeoutError when the request never answers", async () => {
    const hung = new Promise(() => {});
    const result = withTimeout(hung, 5000);
    const assertion = expect(result).rejects.toBeInstanceOf(RequestTimeoutError);

    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it("does not time out before the limit", async () => {
    let settled = false;
    withTimeout(new Promise(() => {}), 5000).catch(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
  });

  it("clears its timer once the request finishes", async () => {
    await withTimeout(Promise.resolve("ok"), 1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("defaults to a 15 second limit", () => {
    expect(REQUEST_TIMEOUT_MS).toBe(15000);
  });
});
