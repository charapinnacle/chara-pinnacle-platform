import { beforeEach, describe, expect, it, vi } from "vitest";
import { featurePlanName, usageText, type UsagePrompt } from "@/lib/billing/limits";
import type { PublicPlan } from "@/lib/billing/pricing";
import { multiCountryText } from "@/lib/requirements/limits";
import { lifecycleRefusal, REQUIREMENT_MESSAGES, requirementRefusal } from "@/lib/requirements/refusal";
import type { RequirementFormInput } from "@/lib/validation/requirement";

const rpcMock = vi.fn();
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const promptsMock = vi.hoisted(() => vi.fn());
const plansMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/usage", () => ({ getUsagePrompts: promptsMock }));
vi.mock("@/lib/dal/pricing", () => ({ listPublicPlans: plansMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { changeRequirementStatus, publishRequirement, saveRequirement } = await import("@/lib/actions/requirements");
const { getMultiCountryPlan } = await import("@/lib/dal/requirements");

const REQUIREMENT = "3f0c2a8e-7b1d-4c5e-9a2f-6d8b1e4c7a90";
const VERSION = "2026-10-27T08:15:30.123456+00:00";
const target = { id: REQUIREMENT, expectedUpdatedAt: VERSION };
const refusal = (message: string, details: string | null, code = "P0001") => ({ data: null, error: { message, details, code } });

function plan(code: string, name: string, features: string[]): PublicPlan {
  return { code, name, priceMinor: 0, currency: "EUR", interval: "month", trialDays: 30, contactSales: false, limits: {}, features };
}

const employerPlans = [
  plan("employer_starter", "Basic", ["shortlisting"]),
  plan("employer_professional", "Professional", ["shortlisting", "multi_country_requirements"]),
  plan("employer_enterprise", "Enterprise", ["shortlisting", "multi_country_requirements"]),
];

const prompt: UsagePrompt = { limitKey: "active_requirements", used: 3, limit: 3, resetsAt: null, planName: "Basic", comparison: null };

describe("the words of the requirement limits (FR-M4 AC9, AC11)", () => {
  it("counts open workforce requirements", () => {
    expect(usageText("active_requirements", "employer", 3, 3)).toBe("3 of 3 open workforce requirements");
    expect(usageText("active_requirements", "employer", 0, 1)).toBe("0 of 1 open workforce requirement");
  });

  it("names the first public plan with several destinations", () => {
    expect(featurePlanName(employerPlans, "multi_country_requirements")).toBe("Professional");
    expect(featurePlanName(employerPlans.slice(0, 1), "multi_country_requirements")).toBeNull();
    expect(multiCountryText("Professional")).toBe("Several destination countries are available on Professional.");
    expect(multiCountryText(null)).toBe("Several destination countries are available on a higher plan.");
  });
});

describe("the error mapping of the requirement limits (FR-M4 AC12)", () => {
  it("maps the limit and the feature to their prompts", () => {
    expect(lifecycleRefusal(refusal("CHARA_LIMIT_REACHED", "active_requirements").error)).toEqual({ kind: "limit" });
    expect(lifecycleRefusal(refusal("CHARA_FEATURE_NOT_IN_PLAN", "multi_country_requirements").error)).toEqual({ kind: "feature" });
    expect(requirementRefusal(refusal("CHARA_FEATURE_NOT_IN_PLAN", "multi_country_requirements").error)).toEqual({ kind: "feature" });
  });

  it("maps an unknown plan to the generic access message and anything else to a fault, never the detail", () => {
    expect(lifecycleRefusal(refusal("CHARA_FORBIDDEN", "unknown_plan", "42501").error)).toEqual({
      kind: "message",
      message: REQUIREMENT_MESSAGES.notAllowed,
    });
    expect(lifecycleRefusal(refusal("CHARA_LIMIT_REACHED", "members").error)).toEqual({
      kind: "message",
      message: "Your plan's limit is reached.",
    });
    expect(lifecycleRefusal(refusal("CHARA_FEATURE_NOT_IN_PLAN", "shortlisting").error)).toEqual({ kind: "fault" });
    expect(lifecycleRefusal(refusal('duplicate key value violates unique constraint "x"', null, "23505").error)).toEqual({ kind: "fault" });
  });

  it("maps the destinations a save refuses to the destination list", () => {
    expect(requirementRefusal(refusal("CHARA_INVALID_INPUT", "countries").error)).toEqual({
      kind: "field",
      field: "destinations.root",
      message: "Add up to 9 further destination countries from the list.",
    });
    expect(
      requirementRefusal(
        refusal('insert or update on table "requirement_countries" violates foreign key constraint "requirement_countries_country_code_fkey"', null, "23503")
          .error,
      ),
    ).toEqual({ kind: "field", field: "destinations.root", message: "Select each destination country from the list." });
  });
});

describe("the actions at the plan limits (FR-M4 AC9, AC12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    releasedMock.mockResolvedValue(true);
    requireOrgRoleMock.mockResolvedValue({ organization: { id: "org-1", slug: "acme-bau", type: "employer", role: "admin" } });
    plansMock.mockResolvedValue(employerPlans);
    promptsMock.mockResolvedValue({ active_requirements: prompt });
  });

  it("answers a publish at the limit with the usage of the upgrade prompt, read after the refusal", async () => {
    rpcMock.mockResolvedValueOnce(refusal("CHARA_LIMIT_REACHED", "active_requirements"));
    expect(await publishRequirement("acme-bau", target, { visibility: "private", showIdentity: false })).toEqual({ limitReached: prompt });
    expect(promptsMock).toHaveBeenCalledWith("org-1", "employer", ["active_requirements"]);
  });

  it("answers a reopen at the limit the same way, and in words when the usage cannot be read", async () => {
    rpcMock.mockResolvedValue(refusal("CHARA_LIMIT_REACHED", "active_requirements"));
    expect(await changeRequirementStatus("acme-bau", target, { to: "open" })).toEqual({ limitReached: prompt });
    promptsMock.mockRejectedValueOnce(new Error("down"));
    expect(await changeRequirementStatus("acme-bau", target, { to: "open" })).toEqual({
      message: "Your plan's limit of open workforce requirements is reached.",
    });
    promptsMock.mockResolvedValueOnce({ active_requirements: null });
    expect(await changeRequirementStatus("acme-bau", target, { to: "open" })).toEqual({
      message: "Your plan's limit of open workforce requirements is reached.",
    });
  });

  it("answers several destinations without the feature with the plan that has it", async () => {
    rpcMock.mockResolvedValueOnce(refusal("CHARA_FEATURE_NOT_IN_PLAN", "multi_country_requirements"));
    expect(await changeRequirementStatus("acme-bau", target, { to: "open" })).toEqual({ multiCountry: { planName: "Professional" } });
    rpcMock.mockResolvedValueOnce(refusal("CHARA_FEATURE_NOT_IN_PLAN", "multi_country_requirements"));
    plansMock.mockRejectedValueOnce(new Error("down"));
    expect(await publishRequirement("acme-bau", target, { visibility: "private", showIdentity: false })).toEqual({
      multiCountry: { planName: null },
    });
  });

  it("puts the refusal of a further destination on the destination list of the form", async () => {
    const input: RequirementFormInput = {
      title: "",
      workersNeeded: "10",
      country: "DE",
      cityRegion: "Hamburg",
      industry: "C",
      destinations: [{ country: "NL" }],
      occupations: [{ occupation: "7212", quantity: "10" }],
      skills: "",
      experienceYears: "",
      startDate: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10),
      durationMonths: "",
      employmentType: "full_time",
      salaryMin: "",
      salaryMax: "",
      salaryCurrency: "",
      salaryPeriod: "",
      accommodation: false,
      workPermitSupport: false,
      visaSupport: false,
      recruitmentPreference: "both",
      partnerNeed: "none",
    };
    rpcMock.mockResolvedValueOnce(refusal("CHARA_FEATURE_NOT_IN_PLAN", "multi_country_requirements"));
    expect(await saveRequirement("acme-bau", null, input)).toEqual({
      errors: { "destinations.root": "Several destination countries are available on Professional." },
    });
    expect(rpcMock).toHaveBeenCalledWith("save_requirement", expect.objectContaining({ p_additional_countries: ["NL"] }));
  });
});

describe("getMultiCountryPlan (FR-M4 AC4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plansMock.mockResolvedValue(employerPlans);
  });

  it("asks the database whether the plan offers further destinations and names the plan that does", async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    expect(await getMultiCountryPlan("org-1")).toEqual({ allowed: false, planName: "Professional" });
    expect(rpcMock).toHaveBeenCalledWith("requirement_multi_country", { p_org: "org-1" });
  });

  it("names no plan when the plans cannot be read, and still offers what the database says", async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    plansMock.mockRejectedValueOnce(new Error("down"));
    expect(await getMultiCountryPlan("org-1")).toEqual({ allowed: true, planName: null });
  });

  it("fails loudly when the database refuses, so the page shows its error", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "CHARA_FORBIDDEN", code: "42501" } });
    await expect(getMultiCountryPlan("org-1")).rejects.toThrow("The plan of the workforce requirements could not be loaded");
  });
});
