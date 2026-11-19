import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extendedClosesOn,
  extendLabel,
  isClosingSoon,
  requirementActions,
  requirementClosesOn,
} from "@/lib/requirements/lifecycle";
import { LIFECYCLE_MESSAGES, lifecycleRefusal } from "@/lib/requirements/refusal";
import { closeFormSchema, publishFormSchema } from "@/lib/validation/requirement-status";
import { statusChangeSchema } from "@/lib/validation/requirement-status-input";

const rpcMock = vi.fn();
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const revalidateMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { changeRequirementStatus, extendRequirement, publishRequirement } = await import("@/lib/actions/requirements");

const REQUIREMENT = "3f0c2a8e-7b1d-4c5e-9a2f-6d8b1e4c7a90";
const VERSION = "2026-10-27T08:15:30.123456+00:00";
const target = { id: REQUIREMENT, expectedUpdatedAt: VERSION };
const refusal = (message: string, details: string | null, code = "P0001") => ({ data: null, error: { message, details, code } });

describe("the end date of decision 3.5 (FR-M2 AC4)", () => {
  it.each([
    ["2027-01-10", "2027-03-01", "2027-04-10"],
    ["2027-01-10", "2027-06-01", "2027-06-01"],
    ["2027-01-10", "2027-04-10", "2027-04-10"],
  ])("published %s, starting %s: closes on %s (as private.requirement_closes_on, pgTAP 157)", (published, start, closes) => {
    expect(requirementClosesOn(published, start, 90)).toBe(closes);
  });

  it("an extension of 30 days on the first case gives 10 May 2027", () => {
    expect(extendedClosesOn("2027-04-10", "2027-03-01", 30)).toBe("2027-05-10");
  });

  it("follows the settings, not constants (NFR-O5)", () => {
    expect(requirementClosesOn("2027-01-10", "2027-03-01", 120)).toBe("2027-05-10");
    expect(extendedClosesOn("2027-04-10", "2027-03-01", 14)).toBe("2027-04-24");
  });

  it("counts an extension from today once the date has passed, as extend_requirement does", () => {
    expect(extendedClosesOn("2027-04-10", "2027-04-20", 30)).toBe("2027-05-20");
  });

  it("crosses months, years and leap days in UTC", () => {
    expect(requirementClosesOn("2027-12-15", "2028-01-01", 90)).toBe("2028-03-14");
    expect(requirementClosesOn("2028-01-01", "2028-01-02", 60)).toBe("2028-03-01");
  });

  it("is closing soon within the reminder period, today included", () => {
    expect(isClosingSoon("2027-04-10", "2027-04-03", 7)).toBe(true);
    expect(isClosingSoon("2027-04-10", "2027-04-10", 7)).toBe(true);
    expect(isClosingSoon("2027-04-10", "2027-04-02", 7)).toBe(false);
    expect(isClosingSoon("2027-04-10", "2027-04-11", 7)).toBe(false);
  });
});

describe("the status actions (FR-M2 AC12)", () => {
  it("offer what the guard allows: Publish on a draft, four on an open, three on a paused, none when final", () => {
    expect(requirementActions).toEqual({
      draft: ["publish"],
      open: ["pause", "close", "fill", "extend"],
      paused: ["reopen", "close", "extend"],
      closed: [],
      filled: [],
    });
  });

  it("name the extension with its days", () => {
    expect(extendLabel(30)).toBe("Extend by 30 days");
    expect(extendLabel(1)).toBe("Extend by 1 day");
  });

  it("the publish choice needs a channel and keeps the company name off by default (decision 3.2)", () => {
    expect(publishFormSchema.safeParse({ showIdentity: false }).error?.issues[0]).toMatchObject({
      path: ["visibility"],
      message: "Choose who can see this requirement.",
    });
    expect(publishFormSchema.parse({ visibility: "job_order_marketplace", showIdentity: true })).toEqual({
      visibility: "job_order_marketplace",
      showIdentity: true,
    });
    expect(publishFormSchema.safeParse({ visibility: "public", showIdentity: false }).success).toBe(false);
  });

  it("a close needs the reason filled or cancelled; expired belongs to the daily job", () => {
    expect(closeFormSchema.safeParse({}).error?.issues[0].message).toBe("Choose why you close this requirement.");
    expect(closeFormSchema.safeParse({ reason: "expired" }).success).toBe(false);
    expect(closeFormSchema.parse({ reason: "cancelled" })).toEqual({ reason: "cancelled" });
  });

  it("a status change is one of the page's: closed only with cancelled, never draft", () => {
    expect(statusChangeSchema.safeParse({ to: "closed" }).success).toBe(false);
    expect(statusChangeSchema.safeParse({ to: "closed", reason: "expired" }).success).toBe(false);
    expect(statusChangeSchema.safeParse({ to: "draft" }).success).toBe(false);
    expect(statusChangeSchema.parse({ to: "closed", reason: "cancelled" })).toEqual({ to: "closed", reason: "cancelled" });
  });
});

describe("lifecycleRefusal", () => {
  it.each([
    [refusal("CHARA_CONFLICT", "stale").error, "This requirement was changed by someone else, reload."],
    [refusal("CHARA_INVALID_TRANSITION", "filled to paused").error, LIFECYCLE_MESSAGES.notPossible],
    [refusal("CHARA_INVALID_STATE", "closes_on_passed").error, LIFECYCLE_MESSAGES.closesOnPassed],
    [refusal("CHARA_INVALID_STATE", "extension_limit").error, LIFECYCLE_MESSAGES.extensionLimit],
    [refusal("CHARA_INVALID_STATE", "closed").error, "This workforce requirement is closed or filled, so it can no longer be changed."],
    [refusal("CHARA_INVALID_INPUT", "start_date").error, LIFECYCLE_MESSAGES.startDatePassed],
    [refusal("CHARA_INVALID_INPUT", "occupation_quantities").error, LIFECYCLE_MESSAGES.quantities],
    [refusal("CHARA_FORBIDDEN", "release_off").error, "Workforce requirements cannot be changed at the moment."],
    [refusal("CHARA_RATE_LIMITED", null).error, "Too many changes were made today. Try again tomorrow."],
  ])("maps %j to its message", (error, message) => {
    expect(lifecycleRefusal(error)).toEqual({ kind: "message", message });
  });

  it("leaves anything else a fault", () => {
    expect(lifecycleRefusal(refusal("CHARA_INVALID_INPUT", "close_reason").error)).toEqual({ kind: "fault" });
    expect(lifecycleRefusal(refusal("relation does not exist", null, "42P01").error)).toEqual({ kind: "fault" });
  });
});

describe("the lifecycle actions (FR-M2 AC1, AC7, AC10, AC12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    releasedMock.mockResolvedValue(true);
    requireOrgRoleMock.mockResolvedValue({ organization: { id: "org-1", slug: "acme-bau", type: "employer", role: "admin" } });
    rpcMock.mockResolvedValue({ data: {}, error: null });
  });

  it("publishes for the organisation of the address with the version the page was drawn with", async () => {
    expect(await publishRequirement("acme-bau", target, { visibility: "job_order_marketplace", showIdentity: true })).toEqual({ done: true });
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme-bau", "admin", { hideFromOutsiders: true });
    expect(rpcMock).toHaveBeenCalledWith("publish_requirement", {
      p_org: "org-1",
      p_requirement: REQUIREMENT,
      p_visibility: "job_order_marketplace",
      p_show_identity: true,
      p_expected_updated_at: VERSION,
    });
    expect(revalidateMock).toHaveBeenCalledWith(`/en/org/acme-bau/requirements/${REQUIREMENT}`);
  });

  it("never asks for the company name on a private requirement", async () => {
    await publishRequirement("acme-bau", target, { visibility: "private", showIdentity: true });
    expect(rpcMock).toHaveBeenCalledWith("publish_requirement", expect.objectContaining({ p_visibility: "private", p_show_identity: false }));
  });

  it("refuses a publish without a channel at the field before the database is asked", async () => {
    expect(await publishRequirement("acme-bau", target, { showIdentity: false } as never)).toEqual({
      errors: { visibility: "Choose who can see this requirement." },
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("closes with the reason cancelled, pauses and fills without one", async () => {
    await changeRequirementStatus("acme-bau", target, { to: "closed", reason: "cancelled" });
    expect(rpcMock).toHaveBeenLastCalledWith("set_requirement_status", {
      p_org: "org-1",
      p_requirement: REQUIREMENT,
      p_status: "closed",
      p_expected_updated_at: VERSION,
      p_close_reason: "cancelled",
    });
    await changeRequirementStatus("acme-bau", target, { to: "paused" });
    expect(rpcMock).toHaveBeenLastCalledWith("set_requirement_status", expect.objectContaining({ p_status: "paused", p_close_reason: undefined }));
    await changeRequirementStatus("acme-bau", target, { to: "filled" });
    expect(rpcMock).toHaveBeenLastCalledWith("set_requirement_status", expect.objectContaining({ p_status: "filled" }));
  });

  it("extends by the version of the page", async () => {
    expect(await extendRequirement("acme-bau", target)).toEqual({ done: true });
    expect(rpcMock).toHaveBeenCalledWith("extend_requirement", { p_org: "org-1", p_requirement: REQUIREMENT, p_expected_updated_at: VERSION });
  });

  it("AC12: tells the second admin that someone else changed it, and draws the page again", async () => {
    rpcMock.mockResolvedValueOnce(refusal("CHARA_CONFLICT", "stale"));
    expect(await changeRequirementStatus("acme-bau", target, { to: "paused" })).toEqual({
      message: "This requirement was changed by someone else, reload.",
    });
    expect(revalidateMock).toHaveBeenCalledWith(`/en/org/acme-bau/requirements/${REQUIREMENT}`);
  });

  it("refuses a bad target, a change the page never offers and the release switch off before the database is asked", async () => {
    expect(await extendRequirement("acme-bau", { id: "not-a-uuid", expectedUpdatedAt: VERSION })).toHaveProperty("message");
    expect(await extendRequirement("acme-bau", { id: REQUIREMENT, expectedUpdatedAt: "yesterday" })).toHaveProperty("message");
    expect(await changeRequirementStatus("acme-bau", target, { to: "draft" } as never)).toHaveProperty("message");
    expect(await extendRequirement("Not A Slug!", target)).toHaveProperty("message");
    releasedMock.mockResolvedValue(false);
    expect(await extendRequirement("acme-bau", target)).toEqual({ message: "Workforce requirements cannot be changed at the moment." });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
  });

  it("an unexpected failure gives a reference and no database text", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      rpcMock.mockResolvedValueOnce(refusal("CHARA_INVALID_INPUT", "close_reason"));
      const result = await changeRequirementStatus("acme-bau", target, { to: "paused" });
      expect(result.message).toMatch(/Reference: [0-9A-F]{8}\.$/);
      expect(result.message).not.toContain("close_reason");
    } finally {
      console.error = original;
    }
  });
});
