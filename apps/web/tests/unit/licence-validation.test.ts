import { describe, expect, it } from "vitest";
import {
  evidenceFileSchema,
  evidenceFormSchema,
  licenceFormSchema,
  parseLicencePatterns,
  sortLicences,
  type LicenceInput,
} from "@/lib/validation/licences";

const countries = [
  { code: "DE", name: "Germany" },
  { code: "PH", name: "Philippines" },
];
const rules = { countries, patterns: { PH: "^DMW-[0-9A-Z-]{6,30}$" }, maxYears: 20, today: "2026-10-26" };
const valid: LicenceInput = {
  country: "ph",
  issuingAuthority: " Department of Migrant Workers ",
  licenceNumber: " DMW-123-LB-031522-R ",
  validUntil: "2028-03-15",
  confirmed: true,
};

function errors(input: Partial<LicenceInput>, schemaRules: Parameters<typeof licenceFormSchema>[0] = rules) {
  const result = licenceFormSchema(schemaRules).safeParse({ ...valid, ...input });
  return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
}

describe("the licence form schema (FR-J2 AC2)", () => {
  it("accepts a complete entry, trimmed and with the country code upper-cased", () => {
    expect(licenceFormSchema(rules).parse(valid)).toEqual({
      country: "PH",
      issuingAuthority: "Department of Migrant Workers",
      licenceNumber: "DMW-123-LB-031522-R",
      validUntil: "2028-03-15",
      confirmed: true,
    });
  });

  it("takes an issuing authority of 2 to 200 characters", () => {
    expect(errors({ issuingAuthority: "A" })).toEqual({ issuingAuthority: "The issuing authority has 2 to 200 characters." });
    expect(errors({ issuingAuthority: "AB" })).toEqual({});
    expect(errors({ issuingAuthority: "A".repeat(200) })).toEqual({});
    expect(errors({ issuingAuthority: "A".repeat(201) })).toEqual({ issuingAuthority: "The issuing authority has 2 to 200 characters." });
    expect(errors({ issuingAuthority: "   " })).toEqual({ issuingAuthority: "Enter the issuing authority." });
  });

  it("takes a number of 3 to 64 characters after trimming", () => {
    const de = { country: "DE" };
    expect(errors({ ...de, licenceNumber: "12" })).toEqual({ licenceNumber: "The number has 3 to 64 characters." });
    expect(errors({ ...de, licenceNumber: " 123 " })).toEqual({});
    expect(errors({ ...de, licenceNumber: "9".repeat(64) })).toEqual({});
    expect(errors({ ...de, licenceNumber: "9".repeat(65) })).toEqual({ licenceNumber: "The number has 3 to 64 characters." });
  });

  it("takes a valid-until date from today to today + 20 years", () => {
    const message = "Choose today or a later date, up to 20 years ahead.";
    expect(errors({ validUntil: "2026-10-25" })).toEqual({ validUntil: message });
    expect(errors({ validUntil: "2026-10-26" })).toEqual({});
    expect(errors({ validUntil: "2046-10-26" })).toEqual({});
    expect(errors({ validUntil: "2046-10-27" })).toEqual({ validUntil: message });
    expect(errors({ validUntil: "" })).toEqual({ validUntil: "Enter the valid-until date." });
    expect(errors({ validUntil: "2027-02-30" })).toEqual({ validUntil: "Choose a valid date." });
  });

  it("keeps the saved date of an edited entry even when it is past, and leaves the window to the database without a bound", () => {
    expect(errors({ validUntil: "2026-01-01" }, { ...rules, savedValidUntil: "2026-01-01" })).toEqual({});
    expect(errors({ validUntil: "2020-01-01" }, { countries, patterns: {} })).toEqual({});
  });

  it("refuses a country that is not in the list and a missing confirmation, at their fields", () => {
    expect(errors({ country: "XX" })).toEqual({ country: "Choose a country from the list." });
    expect(errors({ confirmed: false })).toEqual({ confirmed: "Confirm that this entry is accurate." });
  });

  it("checks the configured number format of the country, and any 3 to 64 characters where none is configured", () => {
    expect(errors({ licenceNumber: "123" })).toEqual({
      licenceNumber: "This does not match the usual format of licence numbers in the Philippines",
    });
    expect(errors({ country: "DE", licenceNumber: "123" })).toEqual({});
    expect(errors({ country: "DE", licenceNumber: "123" }, { ...rules, patterns: { DE: "^BA-" } })).toEqual({
      licenceNumber: "This does not match the usual format of licence numbers in Germany",
    });
    expect(errors({ licenceNumber: "123" }, { ...rules, patterns: { PH: "([" } })).toEqual({});
  });
});

describe("the evidence file and the settings", () => {
  it("takes a PDF, JPG or PNG of at most 15 MB", () => {
    const file = (name: string, size: number, type: string) => evidenceFileSchema.safeParse({ name, size, type }).success;
    expect(file("licence.pdf", 15_728_640, "application/pdf")).toBe(true);
    expect(file("licence.pdf", 15_728_641, "application/pdf")).toBe(false);
    expect(file("licence.jpg", 1000, "image/jpeg")).toBe(true);
    expect(file("licence.png", 1000, "image/png")).toBe(true);
    expect(file("licence.docx", 1000, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(false);
    expect(file("licence.svg", 1000, "image/svg+xml")).toBe(false);
    expect(file("licence.pdf", 0, "application/pdf")).toBe(false);
  });

  it("says why a chosen file is refused, and takes no file at all", () => {
    expect(evidenceFormSchema.safeParse(undefined).success).toBe(true);
    const refused = evidenceFormSchema.safeParse(new File(["not a pdf"], "notes.txt", { type: "text/plain" }));
    expect(refused.error?.issues.map((issue) => issue.message)).toEqual(["Choose a PDF, JPG or PNG file."]);
  });

  it("reads the number formats from the public setting and ignores anything malformed", () => {
    expect(parseLicencePatterns('{"PH": "^DMW-"}')).toEqual({ PH: "^DMW-" });
    expect(parseLicencePatterns("{}")).toEqual({});
    expect(parseLicencePatterns("not json")).toEqual({});
    expect(parseLicencePatterns('{"ph": "x"}')).toEqual({});
    expect(parseLicencePatterns(undefined)).toEqual({});
  });

  it("AC11: lists expired entries first, then by date and country", () => {
    const entry = (country: string, status: "current" | "expired", validUntil: string) => ({ country, status, validUntil });
    expect(
      sortLicences([entry("PH", "current", "2028-01-01"), entry("DE", "current", "2027-01-01"), entry("FR", "expired", "2026-01-01")]).map(
        (item) => item.country,
      ),
    ).toEqual(["FR", "DE", "PH"]);
  });
});
