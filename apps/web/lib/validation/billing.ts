import { z } from "zod";
import { identifierKindOptions, normalizeIdentifier } from "@/lib/validation/organization";
import { slugSchema } from "@/lib/validation/team";

const VAT_ID = /^[A-Z]{2}[A-Z0-9]{6,12}$/;
const REGISTRATION_NUMBER = /^[A-Z0-9]{4,32}$/;
const MAX_FIELD = 64;

const MISSING_IDENTIFIER = "Enter a VAT ID or a company registration number.";
const BAD_VAT_ID = "Enter 2 letters followed by 6 to 12 letters or digits; spaces, dots, hyphens and slashes are ignored.";
const BAD_REGISTRATION_NUMBER = "Enter 4 to 32 letters or digits; spaces, dots, hyphens and slashes are ignored.";

export const checkoutFormSchema = z
  .object({
    billingCountry: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, { error: "Choose the billing country." }),
    vatId: z.string().trim().max(MAX_FIELD, { error: BAD_VAT_ID }),
    registrationNumber: z.string().trim().max(MAX_FIELD, { error: BAD_REGISTRATION_NUMBER }),
    termsAccepted: z.boolean().refine((accepted) => accepted, {
      error: "Accept the Subscription and Billing Terms to continue.",
    }),
  })
  .check((context) => {
    const vatId = normalizeIdentifier(context.value.vatId);
    const registrationNumber = normalizeIdentifier(context.value.registrationNumber);
    const issue = (path: "vatId" | "registrationNumber", message: string) =>
      context.issues.push({ code: "custom", input: context.value[path], path: [path], message });
    if (vatId === "" && registrationNumber === "") {
      issue("vatId", MISSING_IDENTIFIER);
      issue("registrationNumber", MISSING_IDENTIFIER);
      return;
    }
    if (vatId !== "" && !VAT_ID.test(vatId)) issue("vatId", BAD_VAT_ID);
    if (registrationNumber !== "" && !REGISTRATION_NUMBER.test(registrationNumber)) {
      issue("registrationNumber", BAD_REGISTRATION_NUMBER);
    }
  });

export type CheckoutFormInput = z.input<typeof checkoutFormSchema>;

export const planCodeSchema = z.string().regex(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/).max(64);

// What the page adds to the form: the terms version and the trial length that were shown, which the database checks.
export const checkoutInputSchema = z.object({
  slug: slugSchema,
  planCode: planCodeSchema,
  billingCountry: checkoutFormSchema.shape.billingCountry,
  vatId: z.string().trim().max(MAX_FIELD),
  registrationNumber: z.string().trim().max(MAX_FIELD),
  termsVersion: z.number().int().min(0).max(1_000_000),
  disclosedTrialDays: z.number().int().min(0).max(365),
});

export type CheckoutInput = z.input<typeof checkoutInputSchema>;

export const legalEntityFormSchema = z
  .object({
    identifier: z.string().trim().max(MAX_FIELD, { error: BAD_REGISTRATION_NUMBER }),
    identifierKind: z.string().refine((kind) => identifierKindOptions.some((option) => option.value === kind), {
      error: "Choose the type of identifier.",
    }),
  })
  .check((context) => {
    if (!REGISTRATION_NUMBER.test(normalizeIdentifier(context.value.identifier))) {
      context.issues.push({
        code: "custom",
        input: context.value.identifier,
        path: ["identifier"],
        message: BAD_REGISTRATION_NUMBER,
      });
    }
  });

export type LegalEntityFormInput = z.input<typeof legalEntityFormSchema>;

export const BILLING_FAILURE = "We could not start the checkout. Nothing was charged. Try again.";
