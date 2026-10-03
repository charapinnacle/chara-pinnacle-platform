import { describe, expect, it } from "vitest";
import {
  acceptedSchema,
  consentMessage,
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
