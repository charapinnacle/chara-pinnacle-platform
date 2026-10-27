import { beforeEach, describe, expect, it, vi } from "vitest";
import { VACANCIES_MESSAGES, vacanciesRefusal } from "@/lib/requirements/refusal";
import { canCreateVacancies, draftVacanciesText, moreVacanciesText } from "@/lib/requirements/vacancies";

const rpcMock = vi.fn();
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const revalidateMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { createRequirementVacancies } = await import("@/lib/actions/requirements");

const REQUIREMENT = "3f0c2a8e-7b1d-4c5e-9a2f-6d8b1e4c7a90";
const VERSION = "2026-10-27T08:15:30.123456+00:00";
const target = { id: REQUIREMENT, expectedUpdatedAt: VERSION };
const refusal = (message: string, details: string | null, code = "P0001") => ({ data: null, error: { message, details, code } });

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  requireOrgRoleMock.mockResolvedValue({ organization: { id: "org-1", slug: "acme-bau", type: "employer", role: "admin" } });
  rpcMock.mockResolvedValue({
    data: [
      { id: "j1", title: "Welders and flame cutters", occupation_id: "7212" },
      { id: "j2", title: "Structural-metal preparers and erectors", occupation_id: "7214" },
    ],
    error: null,
  });
});

describe("createRequirementVacancies (FR-M1 AC10)", () => {
  it("checks an owner or admin and copies the requirement of the organisation of the address, naming the page's version and list", async () => {
    expect(await createRequirementVacancies("acme-bau", target, 2)).toEqual({ created: 2 });
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme-bau", "admin", { hideFromOutsiders: true });
    expect(rpcMock).toHaveBeenCalledWith("create_vacancies_from_requirement", {
      p_org: "org-1",
      p_requirement: REQUIREMENT,
      p_expected_updated_at: VERSION,
      p_expected_linked: 2,
    });
    expect(revalidateMock).toHaveBeenCalledWith(`/en/org/acme-bau/requirements/${REQUIREMENT}`);
    expect(revalidateMock).toHaveBeenCalledWith("/en/org/acme-bau/jobs");
  });

  it("refuses the release switch off, a bad slug and a bad target before the database is asked", async () => {
    releasedMock.mockResolvedValueOnce(false);
    expect(await createRequirementVacancies("acme-bau", target, 0)).toEqual({ message: "Workforce requirements cannot be changed at the moment." });
    expect((await createRequirementVacancies("Not a slug!", target, 0)).message).toBeDefined();
    expect((await createRequirementVacancies("acme-bau", { id: "nope", expectedUpdatedAt: VERSION }, 0)).message).toBeDefined();
    expect((await createRequirementVacancies("acme-bau", { id: REQUIREMENT, expectedUpdatedAt: "yesterday" }, 0)).message).toBeDefined();
    expect((await createRequirementVacancies("acme-bau", target, -1)).message).toBeDefined();
    expect((await createRequirementVacancies("acme-bau", target, 1.5)).message).toBeDefined();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("says a requirement that is no longer open cannot be copied", async () => {
    for (const status of ["draft", "paused", "closed", "filled"]) {
      rpcMock.mockResolvedValueOnce(refusal("CHARA_INVALID_STATE", status));
      expect(await createRequirementVacancies("acme-bau", target, 0)).toEqual({ message: VACANCIES_MESSAGES.notOpen });
    }
  });

  it("maps the refusals it shares with the other actions", async () => {
    rpcMock.mockResolvedValueOnce(refusal("CHARA_CONFLICT", "stale"));
    expect(await createRequirementVacancies("acme-bau", target, 0)).toEqual({ message: "This requirement was changed by someone else, reload." });
    rpcMock.mockResolvedValueOnce(refusal("CHARA_FORBIDDEN", "aal2_required"));
    expect(await createRequirementVacancies("acme-bau", target, 0)).toEqual({
      message: "You are not allowed to create or edit workforce requirements for this company.",
    });
    rpcMock.mockResolvedValueOnce(refusal("CHARA_NOT_FOUND", null, "P0002"));
    expect(await createRequirementVacancies("acme-bau", target, 0)).toEqual({ message: "This workforce requirement could not be found." });
    rpcMock.mockResolvedValueOnce(refusal("CHARA_RATE_LIMITED", null));
    expect(await createRequirementVacancies("acme-bau", target, 0)).toEqual({ message: "Too many changes were made today. Try again tomorrow." });
  });

  it("an unexpected failure gives a reference and no database text", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      rpcMock.mockResolvedValueOnce(refusal("relation does not exist", "secret detail", "42P01"));
      const result = await createRequirementVacancies("acme-bau", target, 0);
      expect(result.message).toMatch(/^Something went wrong on our side and nothing was changed\. .*Reference: [0-9A-F]{8}\.$/);
      expect(result.message).not.toMatch(/relation|secret/);
    } finally {
      console.error = original;
    }
  });
});

describe("vacanciesRefusal", () => {
  it("names every invalid state as not open and leaves an unknown error a fault", () => {
    expect(vacanciesRefusal({ message: "CHARA_INVALID_STATE", details: "paused" })).toEqual({ kind: "message", message: VACANCIES_MESSAGES.notOpen });
    expect(vacanciesRefusal({ message: "CHARA_FORBIDDEN", details: "release_off" })).toEqual({
      kind: "message",
      message: "Workforce requirements cannot be changed at the moment.",
    });
    expect(vacanciesRefusal({ message: "CHARA_INVALID_INPUT", details: "start_date" })).toEqual({ kind: "fault" });
    expect(vacanciesRefusal({ message: "boom", code: "XX000" })).toEqual({ kind: "fault" });
  });
});

describe("vacancy texts", () => {
  it("offers the copy for an open requirement only", () => {
    expect(canCreateVacancies("open")).toBe(true);
    for (const status of ["draft", "paused", "closed", "filled"] as const) expect(canCreateVacancies(status)).toBe(false);
  });

  it("counts drafts and asks before a further copy", () => {
    expect(draftVacanciesText(1)).toBe("1 draft vacancy");
    expect(draftVacanciesText(2)).toBe("2 draft vacancies");
    expect(moreVacanciesText(1, 2)).toBe("This requirement already has 1 linked vacancy. 2 draft vacancies will be added, one per occupation.");
    expect(moreVacanciesText(4, 1)).toBe("This requirement already has 4 linked vacancies. 1 draft vacancy will be added, one per occupation.");
  });
});
