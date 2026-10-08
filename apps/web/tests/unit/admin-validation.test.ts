import { describe, expect, it } from "vitest";
import {
  auditFilterSchema,
  grantFormSchema,
  legalDocumentSchema,
  mfaResetFormSchema,
  moderationInputSchema,
  rangeSchema,
  searchTermSchema,
  staffReasonSchema,
  statementSchema,
} from "@/lib/validation/admin";

const ID = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";

function message(result: { success: boolean; error?: { issues: { message: string }[] } }): string | undefined {
  return result.error?.issues[0].message;
}

describe("the search term", () => {
  it("is trimmed, then needs 3 to 100 characters", () => {
    expect(searchTermSchema.safeParse("ab")).toMatchObject({ success: false });
    expect(message(searchTermSchema.safeParse("  ab  "))).toBe("Enter at least 3 characters");
    expect(searchTermSchema.parse("  abc  ")).toBe("abc");
    expect(searchTermSchema.safeParse("a".repeat(100)).success).toBe(true);
    expect(searchTermSchema.safeParse("a".repeat(101)).success).toBe(false);
  });
});

describe("the statement of reasons", () => {
  it("needs 10 to 2000 characters after trimming", () => {
    expect(statementSchema.safeParse(" 123456789 ").success).toBe(false);
    expect(statementSchema.parse(`  ${"x".repeat(10)}  `)).toBe("x".repeat(10));
    expect(statementSchema.safeParse("x".repeat(2000)).success).toBe(true);
    expect(statementSchema.safeParse("x".repeat(2001)).success).toBe(false);
    expect(statementSchema.safeParse(undefined).success).toBe(false);
  });

  it("is shorter for the staff actions, which keep the limit of 500", () => {
    expect(staffReasonSchema.safeParse("x".repeat(500)).success).toBe(true);
    expect(staffReasonSchema.safeParse("x".repeat(501)).success).toBe(false);
  });

  it("travels with a target, an id and a direction, and nothing else is accepted", () => {
    const valid = { reason: "Fake profile reported 3x.", target: "user", id: ID, to: "suspended" };
    expect(moderationInputSchema.safeParse(valid).success).toBe(true);
    expect(moderationInputSchema.safeParse({ ...valid, target: "job" }).success).toBe(false);
    expect(moderationInputSchema.safeParse({ ...valid, to: "deleted" }).success).toBe(false);
    expect(moderationInputSchema.safeParse({ ...valid, id: "1" }).success).toBe(false);
  });
});

describe("the audit filter", () => {
  const empty = { actor: "", action: "", entityType: "", entityId: "", from: "", to: "" };

  it("accepts the empty filter, a user id and days", () => {
    expect(auditFilterSchema.safeParse(empty).success).toBe(true);
    expect(auditFilterSchema.safeParse({ ...empty, actor: ID, from: "2026-01-01", to: "2026-01-01" }).success).toBe(true);
  });

  it("names a user id that is not one", () => {
    expect(message(auditFilterSchema.safeParse({ ...empty, actor: "bob" }))).toBe("Enter a valid user id");
  });

  it("names a start after the end, and a date that is not a day", () => {
    expect(message(auditFilterSchema.safeParse({ ...empty, from: "2026-02-01", to: "2026-01-31" }))).toBe(
      "The start date must not be after the end date",
    );
    expect(auditFilterSchema.safeParse({ ...empty, from: "2026-02-30" }).success).toBe(false);
    expect(auditFilterSchema.safeParse({ ...empty, to: "tomorrow" }).success).toBe(false);
  });

  it("bounds the text filters", () => {
    expect(auditFilterSchema.safeParse({ ...empty, action: "a".repeat(101) }).success).toBe(false);
    expect(auditFilterSchema.safeParse({ ...empty, entityId: "a".repeat(201) }).success).toBe(false);
  });
});

describe("the statistics range", () => {
  it("accepts one day and 366 days", () => {
    expect(rangeSchema.safeParse({ from: "2026-03-01", to: "2026-03-01" }).success).toBe(true);
    expect(rangeSchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success).toBe(true);
    expect(rangeSchema.safeParse({ from: "2024-01-01", to: "2024-12-31" }).success).toBe(true);
  });

  it("refuses 367 days, a start after the end and a date that does not exist", () => {
    expect(message(rangeSchema.safeParse({ from: "2024-01-01", to: "2025-01-01" }))).toBe("Choose at most 366 days");
    expect(message(rangeSchema.safeParse({ from: "2026-03-02", to: "2026-03-01" }))).toBe(
      "The start date must not be after the end date",
    );
    expect(rangeSchema.safeParse({ from: "2026-13-01", to: "2026-13-02" }).success).toBe(false);
  });
});

describe("the legal document form", () => {
  const valid = { slug: "privacy-policy", title: "Privacy policy", body: "The text.", changeSummary: "Adds retention periods." };

  it("accepts a document", () => {
    expect(legalDocumentSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["Bad_Slug"],
    ["ab"],
    ["double--dash"],
    ["a".repeat(61)],
    ["-lead"],
  ])("refuses the name %s", (slug) => {
    expect(legalDocumentSchema.safeParse({ ...valid, slug }).success).toBe(false);
  });

  it("bounds the title, the text and the change summary", () => {
    expect(legalDocumentSchema.safeParse({ ...valid, title: "ab" }).success).toBe(false);
    expect(legalDocumentSchema.safeParse({ ...valid, title: "t".repeat(201) }).success).toBe(false);
    expect(legalDocumentSchema.safeParse({ ...valid, body: "   " }).success).toBe(false);
    expect(legalDocumentSchema.safeParse({ ...valid, body: "b".repeat(200_001) }).success).toBe(false);
    expect(legalDocumentSchema.safeParse({ ...valid, changeSummary: "Too short" }).success).toBe(false);
    expect(legalDocumentSchema.safeParse({ ...valid, changeSummary: "s".repeat(1001) }).success).toBe(false);
    expect(legalDocumentSchema.safeParse({ ...valid, body: "b".repeat(200_000), changeSummary: "s".repeat(1000) }).success).toBe(true);
  });
});

describe("the staff forms", () => {
  it("grant a role to an email address, normalised, with a role from the list", () => {
    const parsed = grantFormSchema.parse({ email: " Nia@Example.TEST ", role: "trust_safety", reason: "New hire, ticket 4812" });
    expect(parsed).toEqual({ email: "nia@example.test", role: "trust_safety", reason: "New hire, ticket 4812" });
    expect(message(grantFormSchema.safeParse({ email: "nia@example.test", role: "", reason: "New hire, ticket 4812" }))).toBe("Choose a role");
    expect(grantFormSchema.safeParse({ email: "nia@example.test", role: "owner", reason: "New hire, ticket 4812" }).success).toBe(false);
  });

  it("reset two-step verification only with the box ticked, a user id and a reason", () => {
    const valid = { userId: ID, identityChecked: true, reason: "Lost the phone, identity checked" };
    expect(mfaResetFormSchema.safeParse(valid).success).toBe(true);
    expect(message(mfaResetFormSchema.safeParse({ ...valid, identityChecked: false }))).toBe(
      "Confirm that you verified this person's identity",
    );
    expect(message(mfaResetFormSchema.safeParse({ ...valid, userId: "x" }))).toBe("Enter a valid user id");
    expect(mfaResetFormSchema.safeParse({ ...valid, reason: "123456789" }).success).toBe(false);
  });
});
