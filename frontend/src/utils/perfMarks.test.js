import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DETECTION_LIMIT, detectionLimit, perfEnabled, perfEnd, perfStart } from "./perfMarks";

function setSearch(search) {
  window.history.replaceState(null, "", `/${search}`);
}

afterEach(() => {
  setSearch("");
  delete globalThis.__mapPerf;
  vi.restoreAllMocks();
});

describe("perfMarks (#48)", () => {
  it("is off unless ?perf is in the URL", () => {
    expect(perfEnabled()).toBe(false);
    perfStart("x");
    perfEnd("x");
    expect(globalThis.__mapPerf).toBeUndefined();
  });

  it("records a timing when ?perf=1 is set", async () => {
    setSearch("?perf=1");
    vi.spyOn(console, "info").mockImplementation(() => {});
    perfStart("area-select");
    perfEnd("area-select", { area: 3 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(globalThis.__mapPerf).toEqual([expect.objectContaining({ name: "area-select", area: 3 })]);
  });

  it("uses ?detections=N only for 1-1000", () => {
    expect(detectionLimit()).toBe(DEFAULT_DETECTION_LIMIT);
    setSearch("?detections=1000");
    expect(detectionLimit()).toBe(1000);
    for (const bad of ["0", "1001", "abc", "2.5"]) {
      setSearch(`?detections=${bad}`);
      expect(detectionLimit()).toBe(DEFAULT_DETECTION_LIMIT);
    }
  });
});
