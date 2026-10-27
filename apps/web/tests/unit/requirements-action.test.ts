import { beforeEach, describe, expect, it, vi } from "vitest";
import { requirementRefusal } from "@/lib/requirements/refusal";
import { PROHIBITED_CRITERION, type RequirementFormInput } from "@/lib/validation/requirement";

const rpcMock = vi.fn();
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { saveRequirement } = await import("@/lib/actions/requirements");

const REQUIREMENT = "3f0c2a8e-7b1d-4c5e-9a2f-6d8b1e4c7a90";
const VERSION = "2026-10-27T08:15:30.123456+00:00";
const input: RequirementFormInput = {
  title: "",
  workersNeeded: "100",
  country: "de",
  cityRegion: " Hamburg ",
  industry: "c",
  occupations: [
    { occupation: "7212", quantity: "80" },
    { occupation: "7214", quantity: "20" },
  ],
  skills: "MIG/MAG welding",
  experienceYears: "",
  startDate: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10),
  durationMonths: "",
  employmentType: "full_time",
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "",
  salaryPeriod: "",
  accommodation: false,
  workPermitSupport: true,
  visaSupport: false,
  recruitmentPreference: "both",
  partnerNeed: "recruitment",
};
const refusal = (message: string, details: string | null, code = "P0001") => ({ data: null, error: { message, details, code } });

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  requireOrgRoleMock.mockResolvedValue({ organization: { id: "org-1", slug: "acme-bau", type: "employer", role: "admin" } });
  rpcMock.mockResolvedValue({ data: REQUIREMENT, error: null });
});

describe("saveRequirement (FR-M1)", () => {
  it("AC1: checks an owner or admin at aal2 and saves a draft for the organisation of the address", async () => {
    expect(await saveRequirement("acme-bau", null, input)).toEqual({ savedHref: `/en/org/acme-bau/requirements/${REQUIREMENT}` });
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme-bau", "admin", { hideFromOutsiders: true });
    expect(rpcMock).toHaveBeenCalledWith(
      "save_requirement",
      expect.objectContaining({
        p_org: "org-1",
        p_requirement: undefined,
        p_country_code: "DE",
        p_city_region: "Hamburg",
        p_industry_code: "C",
        p_occupations: [
          { occupation_id: "7212", quantity: 80 },
          { occupation_id: "7214", quantity: 20 },
        ],
        p_partner_need: "recruitment",
      }),
    );
  });

  it("saves the changes of a requirement by its id, naming the version the form was loaded with", async () => {
    await saveRequirement("acme-bau", { id: REQUIREMENT, expectedUpdatedAt: VERSION }, input);
    expect(rpcMock).toHaveBeenCalledWith(
      "save_requirement",
      expect.objectContaining({ p_requirement: REQUIREMENT, p_expected_updated_at: VERSION }),
    );
  });

  it("tells the editor that someone else saved first", async () => {
    rpcMock.mockResolvedValueOnce(refusal("CHARA_CONFLICT", "stale"));
    expect(await saveRequirement("acme-bau", { id: REQUIREMENT, expectedUpdatedAt: VERSION }, input)).toEqual({
      message: "Someone else changed this requirement, reload.",
    });
  });

  it("refuses an invalid form, the release switch off and a bad id before the database is asked", async () => {
    expect(await saveRequirement("acme-bau", null, { ...input, occupations: [{ occupation: "7212", quantity: "90" }] })).toEqual({
      errors: { "occupations.root": "Quantities must add up to 100." },
    });
    expect(await saveRequirement("acme-bau", { id: "not-a-uuid", expectedUpdatedAt: VERSION }, input)).toHaveProperty("message");
    expect(await saveRequirement("acme-bau", { id: REQUIREMENT, expectedUpdatedAt: "yesterday" }, input)).toHaveProperty("message");
    expect(await saveRequirement("Not A Slug!", null, input)).toHaveProperty("message");
    releasedMock.mockResolvedValue(false);
    expect(await saveRequirement("acme-bau", null, input)).toEqual({ message: "Workforce requirements cannot be changed at the moment." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("AC7, AC8: shows refused wording at its field with the explanation", async () => {
    rpcMock.mockResolvedValueOnce(refusal("CHARA_INVALID_INPUT", "prohibited_criterion:skills"));
    expect(await saveRequirement("acme-bau", null, input)).toEqual({ errors: { skills: PROHIBITED_CRITERION } });
  });

  it("an unexpected failure gives a reference and no database text", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      rpcMock.mockResolvedValueOnce(refusal("relation does not exist", "secret detail", "42P01"));
      const result = await saveRequirement("acme-bau", null, input);
      expect(result.message).toMatch(/^Something went wrong on our side and nothing was changed\. .*Reference: [0-9A-F]{8}\.$/);
      expect(result.message).not.toMatch(/relation|secret/);
    } finally {
      console.error = original;
    }
  });
});

describe("requirementRefusal (FR-M1 AC3, AC4, AC7)", () => {
  it.each([
    [refusal("CHARA_INVALID_INPUT", "start_date").error, { kind: "field", field: "startDate", message: "Choose a start date from today to 3 years ahead." }],
    [refusal("CHARA_INVALID_INPUT", "occupation_quantities").error, { kind: "field", field: "occupations.root", message: "Quantities must add up to the number of workers." }],
    [refusal("CHARA_INVALID_INPUT", "prohibited_criterion:title").error, { kind: "field", field: "title", message: PROHIBITED_CRITERION }],
    [refusal("CHARA_INVALID_INPUT", "prohibited_criterion:city_region").error, { kind: "field", field: "cityRegion", message: PROHIBITED_CRITERION }],
    [
      refusal('new row for relation "workforce_requirements" violates check constraint "workforce_requirements_salary_order"', null, "23514").error,
      { kind: "field", field: "salaryMin", message: "The minimum salary cannot be higher than the maximum." },
    ],
    [
      refusal('insert or update on table "requirement_occupations" violates foreign key constraint "requirement_occupations_occupation_id_fkey"', null, "23503").error,
      { kind: "field", field: "occupations.root", message: "Select each occupation from the list." },
    ],
    [refusal("CHARA_FORBIDDEN", "aal2_required").error, { kind: "message", message: "You are not allowed to create or edit workforce requirements for this company." }],
    [refusal("CHARA_FORBIDDEN", "organization_suspended").error, { kind: "message", message: "This organization is suspended, so its workforce requirements cannot be changed." }],
    [refusal("CHARA_NOT_FOUND", null, "P0002").error, { kind: "message", message: "This workforce requirement could not be found." }],
    [refusal("CHARA_CONFLICT", "stale").error, { kind: "message", message: "Someone else changed this requirement, reload." }],
    [refusal("CHARA_INVALID_STATE", "closed").error, { kind: "message", message: "This workforce requirement is closed or filled, so it can no longer be changed." }],
    [refusal("CHARA_RATE_LIMITED", null).error, { kind: "message", message: "Too many changes were made today. Try again tomorrow." }],
    [refusal("CHARA_INVALID_INPUT", "something_new").error, { kind: "fault" }],
  ])("maps %j", (error, expected) => {
    expect(requirementRefusal(error)).toEqual(expected);
  });
});
