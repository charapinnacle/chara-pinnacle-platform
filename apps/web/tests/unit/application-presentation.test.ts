import { describe, expect, it } from "vitest";
import {
  applicationNextSteps,
  applicationStageOptions,
  applicationStatusLabels,
  eventActorLabels,
  isApplicationStatus,
} from "@/lib/applications/presentation";

const stages = ["applied", "viewed", "shortlisted", "interview", "offer", "hired", "rejected", "withdrawn"] as const;

describe("the next-step text of an application (FR-D3 AC8)", () => {
  it("has an entry for every stage and no other, none empty and none longer than 200 characters", () => {
    expect(Object.keys(applicationNextSteps)).toEqual([...stages]);
    for (const stage of stages) {
      const text = applicationNextSteps[stage];
      expect(text.trim(), stage).not.toBe("");
      expect(text.length, stage).toBeLessThanOrEqual(200);
    }
  });

  it("says not selected for a decline and never rejected", () => {
    expect(applicationNextSteps.rejected).toMatch(/not selected/i);
    for (const text of Object.values(applicationNextSteps)) expect(text).not.toMatch(/reject/i);
  });

  it("tells a candidate who withdrew that the employer no longer has access to the shared documents", () => {
    expect(applicationNextSteps.withdrawn).toContain("no longer has access to the shared documents");
  });
});

describe("the stage labels and the filter options", () => {
  it("offers the eight stages in the order of the pipeline, with Not selected for the stored value rejected", () => {
    expect(applicationStageOptions).toEqual([
      { value: "applied", label: "Applied" },
      { value: "viewed", label: "Viewed" },
      { value: "shortlisted", label: "Shortlisted" },
      { value: "interview", label: "Interview" },
      { value: "offer", label: "Offer" },
      { value: "hired", label: "Hired" },
      { value: "rejected", label: "Not selected" },
      { value: "withdrawn", label: "Withdrawn" },
    ]);
    expect(Object.values(applicationStatusLabels)).not.toContain("Rejected");
  });

  it("knows a stored stage and nothing else, not even an inherited property", () => {
    for (const stage of stages) expect(isApplicationStatus(stage)).toBe(true);
    for (const value of ["foo", "", "Interview", "toString", "__proto__", null, undefined, 3, ["interview"]]) {
      expect(isApplicationStatus(value), String(value)).toBe(false);
    }
  });
});

describe("the actor of a timeline event", () => {
  it("is shown as you, the employer or the system, never as a name", () => {
    expect(eventActorLabels).toEqual({ you: "By you", employer: "By the employer", system: "Automatic" });
  });
});
