import { afterEach, describe, expect, it, vi } from "vitest";
import { logTrackerView } from "@/lib/applications/tracker-log";

afterEach(() => vi.restoreAllMocks());

describe("logTrackerView", () => {
  it("writes one JSON line per view that names the page and nobody who looked", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    logTrackerView("list");
    logTrackerView("application");
    expect(write.mock.calls).toEqual([['{"event":"tracker_view","page":"list"}\n'], ['{"event":"tracker_view","page":"application"}\n']]);
  });
});
