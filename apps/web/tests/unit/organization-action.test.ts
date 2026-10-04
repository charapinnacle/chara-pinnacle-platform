import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationFormInput } from "@/lib/validation/organization";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const rpcMock = vi.fn();
const requireUserMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { createOrganization } = await import("@/lib/actions/organizations");

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

describe("createOrganization", () => {
  it("checks the session, sends the normalised values and goes to two-step setup", async () => {
    await expect(createOrganization(input)).rejects.toThrow("REDIRECT:/en/mfa");
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
    await expect(createOrganization(input)).resolves.toEqual({ created: { duplicateLegalName: true } });
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
      message: "You have reached the number of organizations one account can own.",
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
    expect(log).toHaveBeenCalledWith("Create organization failed", { code: "P0001", message: "CHARA_FORBIDDEN" });
    log.mockRestore();
  });
});
