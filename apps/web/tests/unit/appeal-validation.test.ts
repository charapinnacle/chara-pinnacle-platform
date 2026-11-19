import { describe, expect, it } from "vitest";
import { appealCursorParam, appealCursorSchema, appealFormSchema, appealListStatusSchema, idParam, reversedShare } from "@/lib/validation/appeal";

describe("appeal validation (FR-S1 AC12)", () => {
  it("takes grounds of 20 to 2,000 characters after trimming", () => {
    expect(appealFormSchema.safeParse({ grounds: `  ${"g".repeat(20)}  ` }).data).toEqual({ grounds: "g".repeat(20) });
    expect(appealFormSchema.safeParse({ grounds: `  ${"g".repeat(19)}  ` }).success).toBe(false);
    expect(appealFormSchema.safeParse({ grounds: "g".repeat(2000) }).success).toBe(true);
    expect(appealFormSchema.safeParse({ grounds: "g".repeat(2001) }).success).toBe(false);
  });

  it("reads an id of the address and nothing else", () => {
    expect(idParam("42")).toBe(42);
    for (const value of ["0", "-1", "4.2", "x", "1234567890123456", ""]) expect(idParam(value), value).toBeNull();
  });

  it("round-trips both cursors and falls back to the open list", () => {
    const open = { dueAt: "2026-11-02T09:00:00.000Z", id: 7 };
    expect(appealCursorSchema.parse(appealCursorParam(open))).toEqual(open);
    expect(appealCursorSchema.parse(appealCursorParam({ id: 9 }))).toEqual({ id: 9 });
    expect(appealCursorSchema.safeParse("nonsense_x").success).toBe(false);
    expect(appealListStatusSchema.parse("decided")).toBe("decided");
    expect(appealListStatusSchema.parse("closed")).toBe("open");
  });
});

describe("the KPI decisions reversed on appeal", () => {
  it("is the whole percentage of decided appeals that were restored, and nothing before a decision", () => {
    expect(reversedShare(4, 3)).toBe(75);
    expect(reversedShare(3, 1)).toBe(33);
    expect(reversedShare(0, 0)).toBeNull();
  });
});
