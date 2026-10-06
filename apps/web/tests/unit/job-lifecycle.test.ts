import { describe, expect, it } from "vitest";
import { isStaleOpen, STALE_OPEN_TEXT, statusActions } from "@/lib/jobs/lifecycle";

const now = new Date("2026-10-06T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

describe("isStaleOpen", () => {
  it("flags an open vacancy whose last change of status was more than 90 days ago, and only that one", () => {
    expect(isStaleOpen("open", daysAgo(91), now)).toBe(true);
    expect(isStaleOpen("open", daysAgo(90), now)).toBe(false);
    expect(isStaleOpen("open", daysAgo(89), now)).toBe(false);
    expect(isStaleOpen("paused", daysAgo(120), now)).toBe(false);
  });

  it("does not flag any other status, however old", () => {
    for (const status of ["draft", "paused", "closed", "filled"] as const) {
      expect(isStaleOpen(status, daysAgo(400), now)).toBe(false);
    }
  });

  it("counts from the instant of the change, not from the day", () => {
    expect(isStaleOpen("open", new Date(now.getTime() - 90 * 86_400_000 - 1).toISOString(), now)).toBe(true);
  });

  it("goes with a text that names the 90 days", () => {
    expect(STALE_OPEN_TEXT).toBe("Open for more than 90 days");
  });
});

describe("statusActions", () => {
  const offered = (status: keyof typeof statusActions) => statusActions[status].map((action) => action.label);

  it("offers the changes the database allows in each status", () => {
    expect(offered("draft")).toEqual(["Publish"]);
    expect(offered("open")).toEqual(["Pause", "Close", "Mark as filled"]);
    expect(offered("paused")).toEqual(["Reopen", "Close", "Mark as filled"]);
    expect(offered("closed")).toEqual(["Reopen"]);
    expect(offered("filled")).toEqual([]);
  });

  it("targets the statuses of the transition table", () => {
    const pairs = Object.entries(statusActions).flatMap(([from, actions]) => actions.map((action) => `${from}>${action.to}`));
    expect(pairs.sort()).toEqual(
      ["draft>open", "open>closed", "open>filled", "open>paused", "paused>closed", "paused>filled", "paused>open", "closed>open"].sort(),
    );
  });

  it("asks for confirmation before Close and Mark as filled, and says that filled is final", () => {
    const all = Object.values(statusActions).flat();
    expect(all.filter((action) => action.confirm).map((action) => action.to).sort()).toEqual(["closed", "closed", "filled", "filled"]);
    for (const action of all.filter((item) => item.to === "filled")) expect(action.confirm?.body).toMatch(/final/i);
    for (const action of all.filter((item) => item.to === "open" || item.to === "paused")) expect(action.confirm).toBeUndefined();
  });
});
