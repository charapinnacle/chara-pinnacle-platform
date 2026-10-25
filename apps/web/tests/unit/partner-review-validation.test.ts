import { describe, expect, it } from "vitest";
import {
  awaitingReview,
  infoStepIndex,
  missingFieldMessages,
  parseReviewTarget,
  reviewStatusSchema,
  reviewTimeText,
  submittable,
} from "@/lib/validation/partner-review";

describe("the review state of a partner (FR-J1, FR-J4)", () => {
  it("tells the states that may be submitted from those in the queue and those decided", () => {
    const states = reviewStatusSchema.options;
    expect(states.filter(submittable)).toEqual(["onboarding", "info_requested"]);
    expect(states.filter(awaitingReview)).toEqual(["pending_review", "re_review"]);
  });

  it("places the reopened steps on the step indicator of partner onboarding", () => {
    expect(infoStepIndex).toEqual({ company: 0, where_you_serve: 1, commitments: 2 });
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
