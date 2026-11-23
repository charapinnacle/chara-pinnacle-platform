import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationFormInput } from "@/lib/validation/organization";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const rpcMock = vi.fn();
const requireUserMock = vi.hoisted(() => vi.fn());
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const refreshShellMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/app/refresh-shell", () => ({ refreshAppShell: refreshShellMock }));
vi.mock("@/lib/dal/session", () => ({ requireUser: requireUserMock, requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { createOrganization, createPartnerOrganization, updateOrganizationProfile } = await import("@/lib/actions/organizations");

const input: OrganizationFormInput = {
  legalName: "  Acme Bau GmbH ",
  displayName: "",
  country: "de",
  industry: "f",
  website: "",
  identifierKind: "vat_number",
  identifier: "DE 123.456-789",
};
const created = {
  organization_id: "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11",
  slug: "acme-bau-gmbh",
  duplicate_legal_name: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ data: created, error: null });
});

describe("createPartnerOrganization (FR-J1)", () => {
  const partnerInput = { ...input, industry: "", description: "  We place nurses and carers with hospitals in Germany.\nSince 2019. " };

  beforeEach(() => {
    requireUserMock.mockResolvedValue({ id: "user-2", intendedOrganizationType: "recruitment_company" });
  });

  it("creates the type of the profile with the identifier and the description and returns to onboarding", async () => {
    await expect(createPartnerOrganization(partnerInput)).rejects.toThrow("REDIRECT:/en/onboarding");
    expect(redirectMock).toHaveBeenCalledWith("/en/onboarding");
    expect(refreshShellMock).toHaveBeenCalledOnce();
    expect(rpcMock).toHaveBeenCalledWith("create_organization", {
      p_type: "recruitment_company",
      p_legal_name: "Acme Bau GmbH",
      p_display_name: "Acme Bau GmbH",
      p_based_in_country: "DE",
      p_industry_code: "",
      p_website: undefined,
      p_identifier: "DE123456789",
      p_identifier_kind: "vat_number",
      p_description: "We place nurses and carers with hospitals in Germany.\nSince 2019.",
    });
  });

  it("takes the type from the profile only: a form value cannot change it", async () => {
    requireUserMock.mockResolvedValue({ id: "user-2", intendedOrganizationType: "staffing_company" });
    const tampered = { ...partnerInput, type: "recruitment_company" } as typeof partnerInput;
    await expect(createPartnerOrganization(tampered)).rejects.toThrow("REDIRECT");
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_type: "staffing_company" });
  });

  it.each([null, "employer"])("refuses a user whose intended type is %j without calling the database", async (type) => {
    requireUserMock.mockResolvedValue({ id: "user-2", intendedOrganizationType: type });
    await expect(createPartnerOrganization(partnerInput)).resolves.toEqual({ message: expect.any(String) });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("requires the identifier and sends nothing without it", async () => {
    const result = await createPartnerOrganization({ ...partnerInput, identifier: "", identifierKind: "" });
    expect(result?.errors).toEqual({
      identifier: "Enter the registration number, VAT number or other identifier of your company.",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("says that partner registration is closed when release 2a is off in the database", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "CHARA_FORBIDDEN", details: "organization_type_not_available", code: "P0001" },
    });
    await expect(createPartnerOrganization(partnerInput)).resolves.toEqual({
      message: "Registration for recruitment and staffing companies is not open at the moment.",
    });
  });

  it("maps a refused description to its field and keeps the duplicate notice of FR-A2", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "CHARA_INVALID_INPUT", details: "organizations_description_check", code: "P0001" },
    });
    await expect(createPartnerOrganization(partnerInput)).resolves.toEqual({ errors: { description: "Check this value." } });
    rpcMock.mockResolvedValue({ data: { ...created, duplicate_legal_name: true }, error: null });
    await expect(createPartnerOrganization(partnerInput)).resolves.toEqual({ duplicateLegalName: true });
  });
});

describe("createOrganization", () => {
  it("checks the session, sends the normalised values and goes to the two-step set-up step of onboarding", async () => {
    await expect(createOrganization(input)).rejects.toThrow("REDIRECT:/en/onboarding/security");
    expect(refreshShellMock).toHaveBeenCalledOnce();
    expect(requireUserMock).toHaveBeenCalledWith("en");
    expect(rpcMock).toHaveBeenCalledWith("create_organization", {
      p_type: "employer",
      p_legal_name: "Acme Bau GmbH",
      p_display_name: "Acme Bau GmbH",
      p_based_in_country: "DE",
      p_industry_code: "F",
      p_website: undefined,
      p_identifier: "DE123456789",
      p_identifier_kind: "vat_number",
    });
  });

  it("sends no identifier or kind when the identifier is empty", async () => {
    await expect(createOrganization({ ...input, identifier: "", identifierKind: "" })).rejects.toThrow("REDIRECT");
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_identifier: undefined, p_identifier_kind: undefined });
  });

  it("returns the duplicate notice instead of redirecting when the legal name is in use", async () => {
    rpcMock.mockResolvedValue({ data: { ...created, duplicate_legal_name: true }, error: null });
    await expect(createOrganization(input)).resolves.toEqual({ duplicateLegalName: true });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("returns field messages and does not call the database for an invalid input", async () => {
    const result = await createOrganization({ ...input, legalName: "A", website: "ftp://x.example" });
    expect(Object.keys(result?.errors ?? {}).sort()).toEqual(["legalName", "website"]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ message: "CHARA_INVALID_INPUT", details: "legal_entity_identifier", code: "P0001" }, "identifier"],
    [{ message: "CHARA_INVALID_INPUT", details: "organizations_website_check", code: "P0001" }, "website"],
    [
      {
        message: 'insert or update on table "organizations" violates foreign key constraint "organizations_industry_code_fkey"',
        details: "Key (industry_code)=(F) is not present in table",
        code: "23503",
      },
      "industry",
    ],
    [
      {
        message: 'insert or update on table "organizations" violates foreign key constraint "organizations_based_in_country_fkey"',
        details: "",
        code: "23503",
      },
      "country",
    ],
  ])("puts a database refusal on the field %#", async (error, field) => {
    rpcMock.mockResolvedValue({ data: null, error });
    const result = await createOrganization(input);
    expect(Object.keys(result?.errors ?? {})).toEqual([field]);
  });

  it("explains the organization limit", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "CHARA_LIMIT_REACHED", details: "organizations", code: "P0001" },
    });
    await expect(createOrganization(input)).resolves.toEqual({
      message: "You have reached the number of organisations one account can own.",
    });
  });

  it("shows a generic message for any other error and never its text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "CHARA_FORBIDDEN", details: "company_account_required", code: "P0001" },
    });
    await expect(createOrganization(input)).resolves.toEqual({
      message: "We could not complete this request. Try again.",
    });
    expect(log).toHaveBeenCalledWith("Saving the organization failed", { code: "P0001", message: "CHARA_FORBIDDEN" });
    log.mockRestore();
  });
});

describe("updateOrganizationProfile", () => {
  const orgId = "0a1b2c3d-0000-4000-8000-000000000001";
  const profile = { legalName: " Acme Bau AG ", displayName: "", country: "at", industry: "c", website: "", description: "" };
  const refused = (message: string, details: string | null = null) => ({ data: null, error: { code: "P0001", message, details } });

  beforeEach(() => {
    requireOrgRoleMock.mockResolvedValue({
      user: { id: "u" },
      organization: { id: orgId, slug: "acme-bau", type: "employer", role: "admin" },
    });
    rpcMock.mockResolvedValue({ data: { display_name: "Acme Bau AG", duplicate_legal_name: false }, error: null });
  });

  it("checks the owner or admin role at aal2, sends the normalised values, returns the stored display name and redraws the header", async () => {
    await expect(updateOrganizationProfile("acme-bau", profile)).resolves.toEqual({ saved: true, displayName: "Acme Bau AG" });
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme-bau", "admin", { hideFromOutsiders: true, partner: "either" });
    expect(rpcMock).toHaveBeenCalledWith("update_organization_profile", {
      p_org: orgId,
      p_legal_name: "Acme Bau AG",
      p_display_name: "",
      p_based_in_country: "AT",
      p_industry_code: "C",
      p_website: "",
      p_description: "",
    });
    expect(refreshShellMock).toHaveBeenCalledOnce();
  });

  it("passes on the duplicate legal name notice", async () => {
    rpcMock.mockResolvedValue({ data: { display_name: "Acme Bau AG", duplicate_legal_name: true }, error: null });
    await expect(updateOrganizationProfile("acme-bau", profile)).resolves.toEqual({
      saved: true,
      displayName: "Acme Bau AG",
      duplicateLegalName: true,
    });
  });

  it("returns the field errors of an invalid input without calling the database", async () => {
    const result = await updateOrganizationProfile("acme-bau", { ...profile, legalName: "A", website: "javascript:alert(1)" });
    expect(Object.keys(result.errors ?? {}).sort()).toEqual(["legalName", "website"]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("shows the lock of the legal name next to the field", async () => {
    rpcMock.mockResolvedValue(refused("CHARA_FORBIDDEN", "legal_name_locked"));
    await expect(updateOrganizationProfile("acme-bau", profile)).resolves.toEqual({
      errors: { legalName: "The legal name cannot be changed once a payment has been started for the company." },
    });
    expect(refreshShellMock).not.toHaveBeenCalled();
  });

  it("sends a caller below aal2 to two-step verification and back to the profile", async () => {
    rpcMock.mockResolvedValue(refused("CHARA_FORBIDDEN", "aal2_required"));
    await expect(updateOrganizationProfile("acme-bau", profile)).rejects.toThrow(
      `REDIRECT:/en/mfa?next=${encodeURIComponent("/en/org/acme-bau/profile")}`,
    );
  });

  it("FR-J1: lets a partner correct its details and sends it back to the company step of onboarding below aal2", async () => {
    requireOrgRoleMock.mockResolvedValue({
      user: { id: "u" },
      organization: { id: orgId, slug: "manila-skills", type: "recruitment_company", role: "owner" },
    });
    const partnerProfile = { ...profile, industry: "", description: "We place nurses and carers with hospitals in Germany." };
    const short = await updateOrganizationProfile("manila-skills", { ...partnerProfile, description: "Nurses." });
    expect(short.errors, "a partner describes itself in at least 50 characters").toEqual({
      description: "Describe your company in at least 50 characters.",
    });
    expect(rpcMock).not.toHaveBeenCalled();
    await expect(updateOrganizationProfile("manila-skills", partnerProfile)).resolves.toEqual({ saved: true, displayName: "Acme Bau AG" });
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_industry_code: "", p_description: partnerProfile.description });
    rpcMock.mockResolvedValue(refused("CHARA_FORBIDDEN", "aal2_required"));
    await expect(updateOrganizationProfile("manila-skills", partnerProfile)).rejects.toThrow(
      `REDIRECT:/en/mfa?next=${encodeURIComponent("/en/onboarding?step=company")}`,
    );
  });

  it("says a suspended organisation cannot be changed, and maps a constraint to its field", async () => {
    rpcMock.mockResolvedValue(refused("CHARA_FORBIDDEN", "organization_suspended"));
    await expect(updateOrganizationProfile("acme-bau", profile)).resolves.toEqual({
      message: "This organisation is suspended, so its profile cannot be changed.",
    });
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "23503", message: 'violates foreign key constraint "organizations_based_in_country_fkey"', details: null },
    });
    await expect(updateOrganizationProfile("acme-bau", profile)).resolves.toEqual({ errors: { country: "Check this value." } });
  });

  it("sends nothing for a slug that is not a slug or a refused caller", async () => {
    await expect(updateOrganizationProfile("../Acme", profile)).resolves.toEqual({ message: "We could not complete this request. Try again." });
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
    requireOrgRoleMock.mockRejectedValue(new Error("REDIRECT:/en/forbidden"));
    await expect(updateOrganizationProfile("acme-bau", profile)).rejects.toThrow("REDIRECT:/en/forbidden");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
