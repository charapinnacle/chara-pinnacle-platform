import { describe, expect, it } from "vitest";
import {
  acceptedSchema,
  AGE_CONFIRMATION,
  ageConfirmationLabel,
  consentMessage,
  displayTitle,
  isDraftDocument,
  unacceptedDocuments,
  type LegalDocumentSummary,
} from "@/lib/validation/consents";
import {
  fieldErrors,
  resendSchema,
  signUpFormSchema,
  signUpInputSchema,
} from "@/lib/validation/sign-up";

const valid = {
  kind: "worker",
  email: "ana@example.test",
  password: "x".repeat(12),
  consents: [],
};

function messages(input: unknown): Record<string, string> {
  const result = signUpInputSchema.safeParse(input);
  return result.success ? {} : fieldErrors(result.error);
}

function document(slug: string, version: number): LegalDocumentSummary {
  return {
    slug,
    version,
    title: `Title of ${slug}`,
    publishedAt: "2026-10-01T00:00:00Z",
    changeSummary: "Changed.",
  };
}

describe("sign-up schema (FR-A1)", () => {
  it.each([
    [0, false],
    [11, false],
    [12, true],
    [72, true],
    [73, false],
  ])("a password of %i ASCII characters is accepted: %s", (length, accepted) => {
    const errors = messages({ ...valid, password: "x".repeat(length) });
    expect("password" in errors).toBe(!accepted);
  });

  it("names the password field in each password refusal and never returns the value", () => {
    for (const length of [0, 11, 73]) {
      const password = "p".repeat(length);
      const result = signUpInputSchema.safeParse({ ...valid, password });
      expect(result.success).toBe(false);
      const errors = fieldErrors(result.error!);
      expect(errors.password).toMatch(/^(Enter a password|Password )/);
      expect(JSON.stringify(errors)).not.toContain("pppp");
    }
  });

  it("limits the password to 72 bytes, the Auth limit", () => {
    expect(messages({ ...valid, password: "é".repeat(36) })).toEqual({});
    expect(messages({ ...valid, password: "é".repeat(37) }).password).toContain("too long");
  });

  it("trims and lowercases the email", () => {
    const result = signUpInputSchema.parse({ ...valid, email: "  Ana@Example.COM " });
    expect(result.email).toBe("ana@example.com");
  });

  it("refuses an email without an at sign, with a field message", () => {
    expect(messages({ ...valid, email: "ana.example.test" }).email).toBe(
      "Enter a valid email address.",
    );
  });

  it("accepts 254 characters of email and refuses 255", () => {
    const withLength = (length: number) =>
      `${"a".repeat(length - "@example.com".length)}@example.com`;
    expect(messages({ ...valid, email: withLength(254) })).toEqual({});
    expect(messages({ ...valid, email: withLength(255) }).email).toBeDefined();
  });

  it("requires the kind and accepts only worker and company", () => {
    const withoutKind = { email: valid.email, password: valid.password };
    expect(messages(withoutKind).kind).toBe("Choose worker or employer");
    expect(messages({ ...valid, kind: "admin" }).kind).toBe("Choose worker or employer");
    expect(messages({ ...valid, kind: "worker" })).toEqual({});
    expect(messages({ ...valid, kind: "company" })).toEqual({});
  });

  it("allows at most 20 consent entries in the Server Action input", () => {
    const entries = (n: number) =>
      Array.from({ length: n }, () => ({ purpose: "terms-of-service", version: 0 }));
    expect(signUpInputSchema.safeParse({ ...valid, consents: entries(20) }).success).toBe(true);
    expect(signUpInputSchema.safeParse({ ...valid, consents: entries(21) }).success).toBe(false);
    expect(
      signUpInputSchema.safeParse({ ...valid, consents: [{ purpose: "x", version: 1.5 }] }).success,
    ).toBe(false);
  });

  it("validates the resend email the same way", () => {
    expect(resendSchema.parse({ email: " A@B.CO " }).email).toBe("a@b.co");
    expect(resendSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("how a form names a legal document (U67)", () => {
  it("strips the DRAFT: prefix for display and leaves the stored title alone", () => {
    expect(displayTitle("DRAFT: Terms of Service")).toBe("Terms of Service");
    expect(displayTitle("draft:Privacy Policy")).toBe("Privacy Policy");
    expect(displayTitle("Terms of Service")).toBe("Terms of Service");
    expect(displayTitle("The DRAFT: rules")).toBe("The DRAFT: rules");
  });

  it("calls a document a draft by its version 0 or its prefix", () => {
    expect(isDraftDocument({ title: "Terms", version: 0 })).toBe(true);
    expect(isDraftDocument({ title: "DRAFT: Terms", version: 4 })).toBe(true);
    expect(isDraftDocument({ title: "Terms", version: 1 })).toBe(false);
  });

  it("names a missing consent by the plain title", () => {
    expect(consentMessage({ slug: "privacy-policy", title: "DRAFT: Privacy Policy" })).toBe("Accept the Privacy Policy to continue");
  });

  it("reads the age confirmation as the plain sentence for a draft or a missing wording, and as the published wording otherwise", () => {
    expect(ageConfirmationLabel({ title: "DRAFT: Age confirmation", version: 0 }, "I am 18 or older. (DRAFT wording)")).toBe(AGE_CONFIRMATION);
    expect(ageConfirmationLabel({ title: "Age confirmation", version: 2 }, null)).toBe(AGE_CONFIRMATION);
    expect(ageConfirmationLabel({ title: "Age confirmation", version: 2 }, "I am an adult.")).toBe("I am an adult.");
    expect(AGE_CONFIRMATION).toBe("I confirm that I am at least 18 years old.");
  });
});

describe("consent boxes (FR-A8, FR-A9)", () => {
  const documents = [
    document("terms-of-service", 3),
    document("age-18-plus", 1),
  ];

  it("asks for every shown document by name, and for the age attestation in its own words", () => {
    const result = signUpFormSchema(documents).safeParse({
      ...valid,
      accepted: { "terms-of-service": false, "age-18-plus": false },
    });
    expect(result.success).toBe(false);
    const errors = fieldErrors(result.error!);
    expect(errors["accepted.terms-of-service"]).toBe("Accept the Title of terms-of-service to continue");
    expect(errors["accepted.age-18-plus"]).toBe(
      "Confirm that you are 18 or older to create an account",
    );
  });

  it("passes when every shown box is ticked and ignores documents of the other kind", () => {
    expect(
      signUpFormSchema(documents).safeParse({
        ...valid,
        accepted: { "terms-of-service": true, "age-18-plus": true },
      }).success,
    ).toBe(true);
    expect(signUpFormSchema([]).safeParse({ ...valid, accepted: {} }).success).toBe(true);
  });

  it("reports a missing box as refused, not as a type error", () => {
    const result = acceptedSchema(documents).safeParse({});
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.message)).toEqual([
      consentMessage(documents[0]),
      consentMessage(documents[1]),
    ]);
  });

  it("lists the documents without a matching entry of the same version", () => {
    expect(
      unacceptedDocuments(documents, [
        { purpose: "terms-of-service", version: 2 },
        { purpose: "age-18-plus", version: 1 },
      ]).map((d) => d.slug),
    ).toEqual(["terms-of-service"]);
    expect(unacceptedDocuments(documents, [])).toHaveLength(2);
  });
});
