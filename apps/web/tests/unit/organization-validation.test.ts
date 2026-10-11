import { describe, expect, it } from "vitest";
import { fieldErrors } from "@/lib/validation/sign-up";
import { organizationInputSchema, organizationProfileSchema, type OrganizationFormInput } from "@/lib/validation/organization";

const valid: OrganizationFormInput = {
  legalName: "Acme Bau GmbH",
  displayName: "Acme Bau",
  country: "DE",
  industry: "F",
  website: "https://acme-bau.example",
  identifierKind: "vat_number",
  identifier: "DE123456789",
};

function parse(overrides: Partial<OrganizationFormInput>) {
  return organizationInputSchema.safeParse({ ...valid, ...overrides });
}

function errorsFor(overrides: Partial<OrganizationFormInput>) {
  const result = parse(overrides);
  return result.success ? {} : fieldErrors(result.error);
}

describe("organization input schema", () => {
  it("accepts a complete registration and states the employer type", () => {
    const result = parse({});
    expect(result.success && result.data).toEqual({
      type: "employer",
      legalName: "Acme Bau GmbH",
      displayName: "Acme Bau",
      country: "DE",
      industry: "F",
      website: "https://acme-bau.example",
      identifier: "DE123456789",
      identifierKind: "vat_number",
    });
  });

  it.each([
    ["", false],
    ["a", false],
    ["  ", false],
    ["ab", true],
    ["a".repeat(200), true],
    ["a".repeat(201), false],
  ])("legal name %j passes: %s", (legalName, passes) => {
    expect(parse({ legalName }).success).toBe(passes);
    if (!passes) expect(Object.keys(errorsFor({ legalName }))).toEqual(["legalName"]);
  });

  it("trims the legal name", () => {
    const result = parse({ legalName: "  Acme Bau GmbH  " });
    expect(result.success && result.data.legalName).toBe("Acme Bau GmbH");
  });

  it("defaults an empty display name to the legal name and refuses 201 characters", () => {
    for (const displayName of ["", "   "]) {
      const result = parse({ displayName });
      expect(result.success && result.data.displayName).toBe("Acme Bau GmbH");
    }
    expect(parse({ displayName: "d".repeat(200) }).success).toBe(true);
    expect(Object.keys(errorsFor({ displayName: "d".repeat(201) }))).toEqual(["displayName"]);
  });

  it.each([
    ["DE", "DE"],
    ["de", "DE"],
    [" de ", "DE"],
  ])("country %j becomes %s", (input, expected) => {
    const result = parse({ country: input });
    expect(result.success && result.data.country).toBe(expected);
  });

  it.each(["D", "DEU", "", "1A"])("refuses the country %j with a field message", (country) => {
    expect(Object.keys(errorsFor({ country }))).toEqual(["country"]);
  });

  it("requires an industry code and leaves its existence to the database", () => {
    const result = parse({ industry: " f " });
    expect(result.success && result.data.industry).toBe("F");
    for (const industry of ["", "   "]) {
      expect(Object.keys(errorsFor({ industry }))).toEqual(["industry"]);
    }
  });

  it.each([
    ["https://acme-bau.example", true],
    ["http://acme-bau.example/path?q=1", true],
    ["javascript:alert(1)", false],
    ["ftp://x.example", false],
    ["https://", false],
    ["https:example.com", false],
    ["http:///x", false],
    ["https://exa mple.example", false],
    [`https://a.example/${"p".repeat(2048 - "https://a.example/".length)}`, true],
    [`https://a.example/${"p".repeat(2049 - "https://a.example/".length)}`, false],
  ])("website %j passes: %s", (website, passes) => {
    expect(parse({ website }).success).toBe(passes);
    if (!passes) expect(Object.keys(errorsFor({ website }))).toEqual(["website"]);
  });

  it("makes an empty website null", () => {
    for (const website of ["", "  "]) {
      const result = parse({ website });
      expect(result.success && result.data.website).toBeNull();
    }
  });

  it("always states the employer type, whatever is submitted", () => {
    const result = organizationInputSchema.safeParse({ ...valid, type: "recruitment_company" });
    expect(result.success && result.data.type).toBe("employer");
  });

  it("normalises the identifier and needs its kind", () => {
    const result = parse({ identifier: "de 123.456-789/0", identifierKind: "registration_number" });
    expect(result.success && [result.data.identifier, result.data.identifierKind]).toEqual([
      "DE1234567890",
      "registration_number",
    ]);
    expect(Object.keys(errorsFor({ identifierKind: "" }))).toEqual(["identifierKind"]);
    expect(Object.keys(errorsFor({ identifierKind: "passport" }))).toEqual(["identifierKind"]);
  });

  it.each(["x1", "a".repeat(33), "AB#1234"])("refuses the identifier %j", (identifier) => {
    expect(Object.keys(errorsFor({ identifier }))).toEqual(["identifier"]);
  });

  it("accepts 4 and 32 characters", () => {
    expect(parse({ identifier: "ab/12" }).success).toBe(true);
    expect(parse({ identifier: "A".repeat(32) }).success).toBe(true);
  });

  it("makes an empty identifier null with a null kind, whatever the kind says", () => {
    const result = parse({ identifier: "  ", identifierKind: "vat_number" });
    expect(result.success && [result.data.identifier, result.data.identifierKind]).toEqual([null, null]);
  });
});

describe("organization profile schema", () => {
  const profile = { legalName: "Acme Bau GmbH", displayName: "", country: "de", industry: "f", website: "" };
  const profileErrors = (overrides: Record<string, unknown>) => {
    const result = organizationProfileSchema.safeParse({ ...profile, ...overrides });
    return result.success ? {} : fieldErrors(result.error);
  };

  it("applies the registration rules to the company details and has no identifier", () => {
    expect(organizationProfileSchema.parse({ ...profile, identifier: "DE123456789" })).toEqual({ ...profile, country: "DE", industry: "F" });
    expect(Object.keys(profileErrors({ legalName: " A ", displayName: "d".repeat(201), country: "DEU", industry: " ", website: "ftp://x.example" })).sort()).toEqual([
      "country",
      "displayName",
      "industry",
      "legalName",
      "website",
    ]);
    expect(profileErrors({ legalName: "a".repeat(200), displayName: "d".repeat(200), website: "https://acme.example/jobs" })).toEqual({});
  });
});
