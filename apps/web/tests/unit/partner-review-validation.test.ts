import { describe, expect, it } from "vitest";
import {
  awaitingReview,
  decisionFormSchema,
  decisionInputSchema,
  decisionLabels,
  infoStepIndexes,
  missingFieldMessages,
  parseReviewTarget,
  queueCursorParam,
  queueCursorSchema,
  reviewOverdue,
  reviewStatusLabels,
  reviewStatusSchema,
  reviewTimeText,
  STAFF_REVIEW_CHECKS,
  submittable,
} from "@/lib/validation/partner-review";

describe("the review state of a partner (FR-J1, FR-J4)", () => {
  it("tells the states that may be submitted from those in the queue and those decided", () => {
    const states = reviewStatusSchema.options;
    expect(states.filter(submittable)).toEqual(["onboarding", "info_requested"]);
    expect(states.filter(awaitingReview)).toEqual(["pending_review", "re_review"]);
  });

  it("places the reopened steps on the step indicator of partner onboarding", () => {
    expect(infoStepIndexes).toEqual({ company: [0], where_you_serve: [1, 2], commitments: [3], licences: [] });
  });

  it("reads the review target of decision 7.2 from its setting, one working day when it is not a sensible number", () => {
    expect(parseReviewTarget("1")).toBe(1);
    expect(parseReviewTarget("3")).toBe(3);
    expect(parseReviewTarget(undefined)).toBe(1);
    expect(parseReviewTarget("0")).toBe(1);
    expect(parseReviewTarget("two")).toBe(1);
    expect(reviewTimeText(1)).toBe("one working day");
    expect(reviewTimeText(2)).toBe("2 working days");
  });

  it("has a message for every field submit_partner_for_review may name", () => {
    expect(Object.keys(missingFieldMessages).sort()).toEqual([
      "employer_pays_commitment",
      "legal_entity_identifier",
      "occupations",
      "recruitment_type",
      "serves_market",
      "sources_from",
      "staffing_types",
    ]);
  });
});

describe("the staff decision on a partner (FR-J4 AC3, AC11)", () => {
  it("asks for a statement of reasons of 10 to 2,000 characters, trimmed", () => {
    const schema = decisionFormSchema("decline");
    expect(schema.safeParse({ reason: "Too short", infoStep: "" }).success).toBe(false);
    expect(schema.safeParse({ reason: "   Too short   ", infoStep: "" }).success).toBe(false);
    expect(schema.safeParse({ reason: "x".repeat(2001), infoStep: "" }).success).toBe(false);
    expect(schema.safeParse({ reason: "x".repeat(2000), infoStep: "" }).success).toBe(true);
    expect(schema.parse({ reason: "  Registry entry and website match  ", infoStep: "" }).reason).toBe("Registry entry and website match");
  });

  it("needs the step to reopen for a request for information, and only then", () => {
    const request = decisionFormSchema("request_info");
    expect(request.safeParse({ reason: "Please send the registry extract.", infoStep: "" }).success).toBe(false);
    expect(request.safeParse({ reason: "Please send the registry extract.", infoStep: "where_you_serve" }).success).toBe(true);
    expect(decisionFormSchema("approve").safeParse({ reason: "Registry entry matches.", infoStep: "company" }).success).toBe(false);
    const input = { organizationId: "6f1c1c2e-8a3b-4c55-9b1e-2d3f4a5b6c7d", reason: "Registry entry matches." };
    expect(decisionInputSchema.safeParse({ ...input, decision: "request_info", infoStep: null }).success).toBe(false);
    expect(decisionInputSchema.safeParse({ ...input, decision: "approve", infoStep: "company" }).success).toBe(false);
    expect(decisionInputSchema.safeParse({ ...input, decision: "approve", infoStep: null }).success).toBe(true);
    expect(decisionInputSchema.safeParse({ ...input, decision: "suspend", infoStep: null }).success).toBe(false);
  });

  it("marks a review overdue once its target has passed", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    expect(reviewOverdue("2026-10-26T11:59:59Z", now)).toBe(true);
    expect(reviewOverdue("2026-10-26T12:00:01Z", now)).toBe(false);
    expect(reviewOverdue(null, now)).toBe(false);
  });

  it("carries the queue cursor in one query value and refuses anything else", () => {
    const cursor = { at: "2026-10-25T09:00:00.123456+00:00", id: "6f1c1c2e-8a3b-4c55-9b1e-2d3f4a5b6c7d" };
    expect(queueCursorSchema.parse(queueCursorParam(cursor))).toEqual(cursor);
    expect(queueCursorSchema.safeParse("2026-10-25T09:00:00Z").success).toBe(false);
    expect(queueCursorSchema.safeParse("yesterday_6f1c1c2e-8a3b-4c55-9b1e-2d3f4a5b6c7d").success).toBe(false);
  });

  it("never calls a decision a verification or an approval in what staff or partners read (decision 2.6)", () => {
    const words = [...Object.values(reviewStatusLabels), ...Object.values(decisionLabels), ...STAFF_REVIEW_CHECKS].join(" ");
    expect(words).not.toMatch(/verified|approved/i);
  });
});
