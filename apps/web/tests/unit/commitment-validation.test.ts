import { describe, expect, it } from "vitest";
import {
  commitmentOutdated,
  commitmentSchema,
  commitmentStatusSchema,
  WORKERS_NEVER_PAY,
} from "@/lib/validation/commitment";

describe("the employer-pays commitment (FR-J3)", () => {
  it("needs the box ticked, with the message of AC1", () => {
    expect(commitmentSchema.safeParse({ confirmed: true }).success).toBe(true);
    const refused = commitmentSchema.safeParse({ confirmed: false });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]).toMatchObject({ path: ["confirmed"], message: "Please confirm the commitment to continue." });
    expect(commitmentSchema.safeParse({}).success).toBe(false);
  });

  it("reads the status of the database", () => {
    expect(commitmentStatusSchema.parse({ version: 0, is_draft: true, accepted: false, accepted_version: null })).toEqual({
      version: 0,
      isDraft: true,
      accepted: false,
      acceptedVersion: null,
    });
    expect(commitmentStatusSchema.safeParse({ version: -1, is_draft: true, accepted: false, accepted_version: null }).success).toBe(false);
  });

  it("calls a commitment outdated only when an earlier version was accepted", () => {
    const status = (accepted: boolean, acceptedVersion: number | null) => ({ version: 2, isDraft: false, accepted, acceptedVersion });
    expect(commitmentOutdated(status(false, 1))).toBe(true);
    expect(commitmentOutdated(status(false, null))).toBe(false);
    expect(commitmentOutdated(status(true, 2))).toBe(false);
  });

  it("states the line every partner page shows", () => {
    expect(WORKERS_NEVER_PAY).toBe("Workers never pay fees to get a job through Chara Pinnacle");
  });
});
