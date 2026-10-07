import { describe, expect, it } from "vitest";
import { SAVED_PAGE_SIZE, savedPath } from "@/lib/jobs/saved";
import { parseListCursor } from "@/lib/validation/job";

const id = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const cursor = `2026-10-06T10:00:00.123456Z|${id}`;

describe("parseListCursor", () => {
  it("accepts the cursor list_saved_jobs returns", () => {
    expect(parseListCursor(cursor)).toBe(cursor);
  });

  it("drops everything the function would refuse, so a mistyped address shows the first page", () => {
    for (const value of [
      undefined,
      null,
      "",
      ["a", "b"],
      42,
      "x|y",
      `2026-10-06T10:00:00Z|${id}`,
      `2026-10-06T10:00:00.123456+00:00|${id}`,
      `2026-13-45T10:00:00.123456Z|${id}`,
      `2026-02-31T10:00:00.123456Z|${id}`,
      `2026-10-06T25:00:00.123456Z|${id}`,
      `2026-10-06T10:00:00.123456Z|${id.toUpperCase()}`,
      `2026-10-06T10:00:00.123456Z|not-a-uuid`,
      `${cursor}|extra`,
      `${cursor}\n`,
      `'; drop table saved_jobs; --`,
    ]) {
      expect(parseListCursor(value), String(value)).toBeNull();
    }
  });
});

describe("savedPath", () => {
  it("is the saved page, with the cursor encoded when there is one", () => {
    expect(savedPath("en")).toBe("/en/saved");
    expect(savedPath("en", cursor)).toBe(`/en/saved?cursor=${encodeURIComponent(cursor)}`);
  });
});

describe("SAVED_PAGE_SIZE", () => {
  it("is the 20 rows of the criteria", () => {
    expect(SAVED_PAGE_SIZE).toBe(20);
  });
});
