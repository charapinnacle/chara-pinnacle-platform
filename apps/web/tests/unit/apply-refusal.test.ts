import { describe, expect, it } from "vitest";
import { applyRefusalResult, type ApplyRefusal } from "@/lib/applications/apply-refusal";

const answer = (refusal: ApplyRefusal) => applyRefusalResult(refusal, "en");

describe("D89, FR-D1 AC12: every apply refusal has its own message the candidate can act on", () => {
  it("a vacancy that is not open shows the not-accepting notice with the way to the search", () => {
    expect(answer({ kind: "not_open" })).toEqual({ message: "This vacancy is no longer accepting applications", notOpen: true });
  });

  it("an incomplete passport names each missing field and links to its section", () => {
    expect(answer({ kind: "profile_incomplete", missing: ["occupation_id"] })).toEqual({
      message: "Add your occupation to your passport before you apply.",
      links: [{ label: "Add your occupation", href: "/en/passport#occupation" }],
    });
    expect(answer({ kind: "profile_incomplete", missing: ["first_name", "current_country", "occupation_id"] })).toEqual({
      message: "Add your first name, current country and occupation to your passport before you apply.",
      links: [
        { label: "Add your first name", href: "/en/passport#basics" },
        { label: "Add your current country", href: "/en/passport#basics" },
        { label: "Add your occupation", href: "/en/passport#occupation" },
      ],
    });
  });

  it("a passport refusal without a known field still leads to the passport", () => {
    expect(answer({ kind: "profile_incomplete", missing: [] })).toEqual({
      message: "Complete your passport before you apply.",
      links: [{ label: "Open your passport", href: "/en/passport" }],
    });
  });

  it("the rate limit says how long to wait, in whole minutes rounded up", () => {
    expect(answer({ kind: "rate_limited", retryAfterSeconds: 3600 }).message).toBe(
      "You have sent many applications in a short time. Try again in 60 minutes.",
    );
    expect(answer({ kind: "rate_limited", retryAfterSeconds: 61 }).message).toBe(
      "You have sent many applications in a short time. Try again in 2 minutes.",
    );
    expect(answer({ kind: "rate_limited", retryAfterSeconds: 30 }).message).toBe(
      "You have sent many applications in a short time. Try again in 1 minute.",
    );
    expect(answer({ kind: "rate_limited", retryAfterSeconds: null }).message).toBe(
      "You have sent many applications in a short time. Try again later.",
    );
  });

  it("a document deleted meanwhile asks for a reload", () => {
    expect(answer({ kind: "document_not_found" })).toEqual({
      message: "One of the selected documents is no longer available. Reload the page and choose again.",
    });
  });

  it("an account that is not a candidate and one in closure are told apart, the second with the way to settings", () => {
    expect(answer({ kind: "not_candidate" })).toEqual({ message: "Only an active candidate account can apply." });
    expect(answer({ kind: "account_inactive" })).toEqual({
      message: "Your account is being closed, so you cannot apply. Cancel the closure in your settings to apply again.",
      links: [{ label: "Go to settings", href: "/en/settings" }],
    });
  });

  it("input the database refuses after the form accepted it is shown on its field", () => {
    expect(answer({ kind: "invalid_input", field: "coverNote" })).toEqual({
      errors: { coverNote: "Your cover note is too long. Shorten it and submit again." },
    });
    expect(answer({ kind: "invalid_input", field: "documentIds" })).toEqual({
      errors: { documentIds: "You selected too many documents. Choose fewer and submit again." },
    });
  });

  it("a system fault says applications are unavailable, with the reference and no internal code", () => {
    const result = answer({ kind: "fault", reference: "1A2B3C4D" });
    expect(result).toEqual({ message: "Applications are temporarily unavailable. Please try again later. Reference: 1A2B3C4D." });
    expect(result.message).not.toMatch(/CHARA_|SETTING|sharing-notice|Try again\.$/);
  });

  it("no message is the generic one of the owner's report", () => {
    const refusals: ApplyRefusal[] = [
      { kind: "not_open" },
      { kind: "profile_incomplete", missing: ["occupation_id"] },
      { kind: "rate_limited", retryAfterSeconds: 60 },
      { kind: "document_not_found" },
      { kind: "not_candidate" },
      { kind: "account_inactive" },
      { kind: "fault", reference: "1A2B3C4D" },
    ];
    for (const refusal of refusals) {
      expect(answer(refusal).message, refusal.kind).not.toBe("We could not complete this request. Try again.");
    }
  });
});
