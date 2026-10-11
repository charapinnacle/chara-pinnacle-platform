import { describe, expect, it } from "vitest";
import { fieldErrors } from "@/lib/validation/sign-up";
import {
  reportMoveInputSchema,
  reportListStatuses,
  reportListStatusLabels,
  reportReferenceSchema,
  reportCursorSchema,
  reportFormSchemaFor,
  reportInputSchema,
  reportListFilterSchema,
} from "@/lib/validation/report";

const ID = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const valid = {
  link: `/en/jobs/${ID}`,
  category: "misleading_or_fraud",
  details: "The vacancy asks for a fee before any work.",
  email: "",
  goodFaith: true,
};

function errorsOf(type: Parameters<typeof reportFormSchemaFor>[0], known: boolean, over: Record<string, unknown> = {}) {
  const result = reportFormSchemaFor(type, known).safeParse({ ...valid, ...over });
  return result.success ? {} : fieldErrors(result.error);
}

describe("the report form", () => {
  it("accepts a complete report of each kind", () => {
    expect(errorsOf("job", false)).toEqual({});
    expect(errorsOf("company", false)).toEqual({});
    expect(errorsOf("content", false, { link: "/en/pricing" })).toEqual({});
    expect(errorsOf("profile", true, { link: "" })).toEqual({});
  });

  it("asks for a link only when the target is not known, and checks it by the kind", () => {
    expect(Object.keys(errorsOf("job", false, { link: "welder" }))).toEqual(["link"]);
    expect(errorsOf("job", true, { link: "" })).toEqual({});
    expect(Object.keys(errorsOf("content", false, { link: "//evil.example" }))).toEqual(["link"]);
  });

  it("needs a category from the list", () => {
    expect(Object.keys(errorsOf("job", true, { category: "" }))).toEqual(["category"]);
    expect(Object.keys(errorsOf("job", true, { category: "spam" }))).toEqual(["category"]);
  });

  it("needs 20 to 2000 characters of text after trimming", () => {
    expect(Object.keys(errorsOf("job", true, { details: "Nineteen chars 19.." }))).toEqual(["details"]);
    expect(Object.keys(errorsOf("job", true, { details: ` ${"x".repeat(19)} ` }))).toEqual(["details"]);
    expect(errorsOf("job", true, { details: "y".repeat(20) })).toEqual({});
    expect(errorsOf("job", true, { details: "y".repeat(2000) })).toEqual({});
    expect(Object.keys(errorsOf("job", true, { details: "y".repeat(2001) }))).toEqual(["details"]);
  });

  it("counts characters as the database does: ten emoji are ten characters, too few", () => {
    expect(Object.keys(errorsOf("job", true, { details: "😀".repeat(10) }))).toEqual(["details"]);
    expect(errorsOf("job", true, { details: "😀".repeat(20) })).toEqual({});
    expect(errorsOf("job", true, { details: "😀".repeat(2000) })).toEqual({});
    expect(Object.keys(errorsOf("job", true, { details: "😀".repeat(2001) }))).toEqual(["details"]);
  });

  it("makes the email optional but valid when given", () => {
    expect(errorsOf("job", true, { email: "  " })).toEqual({});
    expect(errorsOf("job", true, { email: "reporter@example.test" })).toEqual({});
    expect(Object.keys(errorsOf("job", true, { email: "reporter" }))).toEqual(["email"]);
  });

  it("requires the statement of good faith", () => {
    expect(Object.keys(errorsOf("job", true, { goodFaith: false }))).toEqual(["goodFaith"]);
  });
});

describe("the input of the action", () => {
  const input = { type: "job", target: `/en/jobs/${ID}`, category: "other", details: valid.details, email: "", goodFaith: true };

  it("accepts a report and trims what it keeps", () => {
    const parsed = reportInputSchema.parse({ ...input, target: ` ${input.target} `, details: `  ${valid.details}  ` });
    expect(parsed.target).toBe(input.target);
    expect(parsed.details).toBe(valid.details);
  });

  it("refuses an unknown kind, an empty target and a missing statement of good faith", () => {
    expect(reportInputSchema.safeParse({ ...input, type: "account" }).success).toBe(false);
    expect(reportInputSchema.safeParse({ ...input, target: " " }).success).toBe(false);
    expect(reportInputSchema.safeParse({ ...input, goodFaith: false }).success).toBe(false);
  });
});

describe("moving a report", () => {
  it("needs a reason of 10 to 2000 characters, as every statement of reasons", () => {
    const move = { id: 7, status: "dismissed", reason: "Nothing in it breaks the rules." };
    expect(reportMoveInputSchema.safeParse(move).success).toBe(true);
    expect(reportMoveInputSchema.safeParse({ ...move, status: "in_review" }).success).toBe(true);
    expect(reportMoveInputSchema.safeParse({ ...move, reason: "short" }).success).toBe(false);
    expect(reportMoveInputSchema.safeParse({ ...move, reason: "n".repeat(2001) }).success).toBe(false);
  });

  it("moves to review, actioned or dismissed only, for a report that has an id", () => {
    const move = { id: 7, status: "actioned", reason: "The vacancy was hidden." };
    expect(reportMoveInputSchema.safeParse(move).success).toBe(true);
    expect(reportMoveInputSchema.safeParse({ ...move, status: "new" }).success).toBe(false);
    expect(reportMoveInputSchema.safeParse({ ...move, id: 0 }).success).toBe(false);
  });
});

describe("the filters and the cursor of the lists", () => {
  it("names every status of the filter once, in words", () => {
    expect(Object.keys(reportListStatusLabels)).toEqual([...reportListStatuses]);
  });

  it("falls back to the open reports for a status it does not know, and drops an unknown kind", () => {
    expect(reportListFilterSchema.parse({})).toEqual({ status: "open" });
    expect(reportListFilterSchema.parse({ status: "bogus", type: "account" })).toEqual({ status: "open" });
    expect(reportListFilterSchema.parse({ status: "dismissed", type: "company" })).toEqual({ status: "dismissed", type: "company" });
  });

  it("reads the cursor of a reporter's list from the address and refuses a made-up one", () => {
    expect(reportCursorSchema.parse({ at: "2026-10-11T10:00:00.123456+00:00", id: "42" })).toEqual({ at: "2026-10-11T10:00:00.123456+00:00", id: 42 });
    expect(reportCursorSchema.safeParse({ at: "yesterday", id: "42" }).success).toBe(false);
    expect(reportCursorSchema.safeParse({ at: "2026-10-11T10:00:00+00:00", id: "-1" }).success).toBe(false);
    expect(reportCursorSchema.safeParse({}).success).toBe(false);
  });
});

describe("the reference of a report", () => {
  it("has six digits or more, so that a reference past a million is not cut", () => {
    expect(reportReferenceSchema.safeParse({ reference: "R-000042", is_duplicate: false }).success).toBe(true);
    expect(reportReferenceSchema.safeParse({ reference: "R-1234567", is_duplicate: true }).success).toBe(true);
    expect(reportReferenceSchema.safeParse({ reference: "R-42", is_duplicate: false }).success).toBe(false);
  });
});
