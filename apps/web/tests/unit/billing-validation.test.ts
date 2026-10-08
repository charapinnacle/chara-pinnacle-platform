import { describe, expect, it } from "vitest";
import { checkoutFormSchema, checkoutInputSchema, legalEntityFormSchema } from "@/lib/validation/billing";

const form = { billingCountry: "de", vatId: "DE 123-456.789", registrationNumber: "", termsAccepted: true };

function issues(input: unknown, schema: { safeParse(value: unknown): { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } }) {
  const result = schema.safeParse(input);
  return result.success ? [] : (result.error?.issues ?? []).map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("the checkout form (FR-G2 AC3, AC6)", () => {
  it("accepts a VAT ID in any spelling, and upper-cases the country", () => {
    const result = checkoutFormSchema.parse(form);
    expect(result.billingCountry).toBe("DE");
    expect(issues({ ...form, vatId: "de1234 5678", registrationNumber: "hrb 12-345/6" }, checkoutFormSchema)).toEqual([]);
  });

  it("accepts the boundary lengths after normalisation", () => {
    expect(issues({ ...form, vatId: "DE123456" }, checkoutFormSchema)).toEqual([]);
    expect(issues({ ...form, vatId: "DE123456789012" }, checkoutFormSchema)).toEqual([]);
    expect(issues({ ...form, vatId: "", registrationNumber: "AB12" }, checkoutFormSchema)).toEqual([]);
    expect(issues({ ...form, vatId: "", registrationNumber: "A".repeat(32) }, checkoutFormSchema)).toEqual([]);
  });

  it("refuses a VAT ID that is too short, too long or without its two letters, naming the field", () => {
    for (const vatId of ["DE12", "D123456789", "12345678", "DE123456789012345"]) {
      expect(issues({ ...form, vatId }, checkoutFormSchema), vatId).toEqual([
        "vatId: Enter 2 letters followed by 6 to 12 letters or digits; spaces, dots, hyphens and slashes are ignored.",
      ]);
    }
  });

  it("refuses a registration number of 3 or 33 characters or with a symbol", () => {
    for (const registrationNumber of ["AB1", "A".repeat(33), "AB-12*"]) {
      expect(issues({ ...form, vatId: "", registrationNumber }, checkoutFormSchema), registrationNumber).toEqual([
        "registrationNumber: Enter 4 to 32 letters or digits; spaces, dots, hyphens and slashes are ignored.",
      ]);
    }
  });

  it("asks for at least one identifier, on both fields", () => {
    expect(issues({ ...form, vatId: "  ", registrationNumber: " - " }, checkoutFormSchema)).toEqual([
      "vatId: Enter a VAT ID or a company registration number.",
      "registrationNumber: Enter a VAT ID or a company registration number.",
    ]);
  });

  it("needs a country of two letters and the terms accepted", () => {
    expect(issues({ ...form, billingCountry: "" }, checkoutFormSchema)).toEqual(["billingCountry: Choose the billing country."]);
    expect(issues({ ...form, billingCountry: "DEU" }, checkoutFormSchema)).toEqual(["billingCountry: Choose the billing country."]);
    expect(issues({ ...form, termsAccepted: false }, checkoutFormSchema)).toEqual([
      "termsAccepted: Accept the Subscription and Billing Terms to continue.",
    ]);
  });
});

describe("the input of the checkout action", () => {
  const input = {
    slug: "acme",
    planCode: "employer_starter",
    billingCountry: "de",
    vatId: " DE123456789 ",
    registrationNumber: "",
    termsVersion: 2,
    disclosedTrialDays: 30,
  };

  it("trims and upper-cases what the form sends", () => {
    expect(checkoutInputSchema.parse(input)).toEqual({ ...input, billingCountry: "DE", vatId: "DE123456789" });
  });

  it.each([
    ["a slug with capitals", { slug: "Acme" }],
    ["a plan code that is not snake case", { planCode: "Employer Starter" }],
    ["a negative terms version", { termsVersion: -1 }],
    ["a trial length of 366 days", { disclosedTrialDays: 366 }],
    ["a fractional trial length", { disclosedTrialDays: 1.5 }],
    ["an identifier of 65 characters", { vatId: "D".repeat(65) }],
  ])("refuses %s", (_, change) => {
    expect(checkoutInputSchema.safeParse({ ...input, ...change }).success).toBe(false);
  });
});

describe("the company identifier form", () => {
  it("needs 4 to 32 letters or digits and a type from the list", () => {
    expect(issues({ identifier: "de 123 456 789", identifierKind: "vat_number" }, legalEntityFormSchema)).toEqual([]);
    expect(issues({ identifier: "x1", identifierKind: "vat_number" }, legalEntityFormSchema)).toEqual([
      "identifier: Enter 4 to 32 letters or digits; spaces, dots, hyphens and slashes are ignored.",
    ]);
    expect(issues({ identifier: "DE123456789", identifierKind: "passport" }, legalEntityFormSchema)).toEqual([
      "identifierKind: Choose the type of identifier.",
    ]);
    expect(issues({ identifier: "DE123456789", identifierKind: "" }, legalEntityFormSchema)).toEqual([
      "identifierKind: Choose the type of identifier.",
    ]);
  });
});
