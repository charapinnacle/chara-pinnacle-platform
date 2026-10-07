import { describe, expect, it } from "vitest";
import { applicationStatusLabels } from "@/lib/applications/presentation";
import { allowedTargets } from "@/lib/applications/stage-machine";

const all = ["applied", "viewed", "shortlisted", "interview", "offer", "hired", "rejected", "withdrawn"] as const;
const withShortlisting = { shortlisting: true };

describe("allowedTargets for an employer member", () => {
  it.each([
    ["applied", ["shortlisted", "interview", "rejected"]],
    ["viewed", ["shortlisted", "interview", "rejected"]],
    ["shortlisted", ["interview", "offer", "rejected"]],
    ["interview", ["offer", "rejected"]],
    ["offer", ["hired", "rejected"]],
    ["hired", []],
    ["rejected", []],
    ["withdrawn", []],
  ] as const)("offers from %s exactly %j", (status, targets) => {
    expect(allowedTargets(status, "employer", withShortlisting)).toEqual(targets);
  });

  it("leaves Shortlisted out when the plan has no shortlisting feature, and nothing else", () => {
    expect(allowedTargets("applied", "employer", { shortlisting: false })).toEqual(["interview", "rejected"]);
    expect(allowedTargets("viewed", "employer", { shortlisting: false })).toEqual(["interview", "rejected"]);
    expect(allowedTargets("shortlisted", "employer", { shortlisting: false })).toEqual(["interview", "offer", "rejected"]);
  });

  it("never offers Applied, Viewed or Withdrawn, and the 13 moves are all there is", () => {
    const moves = all.flatMap((status) => allowedTargets(status, "employer", withShortlisting).map((target) => [status, target]));
    expect(moves).toHaveLength(13);
    const targets = new Set(moves.map(([, target]) => target));
    expect(["applied", "viewed", "withdrawn"].filter((target) => targets.has(target as (typeof all)[number]))).toEqual([]);
  });
});

describe("allowedTargets for the candidate", () => {
  it("offers Withdrawn from every state that is not final, and nothing from a final one", () => {
    for (const status of ["applied", "viewed", "shortlisted", "interview", "offer"] as const) {
      expect(allowedTargets(status, "candidate", withShortlisting)).toEqual(["withdrawn"]);
    }
    for (const status of ["hired", "rejected", "withdrawn"] as const) {
      expect(allowedTargets(status, "candidate", withShortlisting)).toEqual([]);
    }
  });
});

describe("the stage labels", () => {
  it("names the stored value rejected Not selected and the others by their own name", () => {
    expect(applicationStatusLabels).toEqual({
      applied: "Applied",
      viewed: "Viewed",
      shortlisted: "Shortlisted",
      interview: "Interview",
      offer: "Offer",
      hired: "Hired",
      rejected: "Not selected",
      withdrawn: "Withdrawn",
    });
  });
});
