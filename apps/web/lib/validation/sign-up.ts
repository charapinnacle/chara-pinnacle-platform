import * as z from "zod";
import {
  acceptedSchema,
  consentEntriesSchema,
  type LegalDocumentSummary,
} from "@/lib/validation/consents";

export const PASSWORD_MIN_LENGTH = 12;
const MAX_PASSWORD_BYTES = 72;

export const accountKindSchema = z.enum(["worker", "company"], {
  error: "Choose worker or employer",
});

export const partnerTypeSchema = z.enum(["recruitment_company", "staffing_company"]);

export type PartnerType = z.infer<typeof partnerTypeSchema>;

// The choice of the sign-up form (FR-J1): the account kind, or a partner type, which is a company account of that type.
export const accountChoiceSchema = z.enum(["worker", "company", ...partnerTypeSchema.options], {
  error: "Choose your account type",
});

export type AccountChoice = z.infer<typeof accountChoiceSchema>;

// The documents of each choice the sign-up form offers; the partner types are present only while release 2a is on.
export type SignUpDocuments = Record<z.infer<typeof accountKindSchema>, LegalDocumentSummary[]> &
  Partial<Record<PartnerType, LegalDocumentSummary[]>>;

export function splitAccountChoice(choice: AccountChoice): {
  kind: z.infer<typeof accountKindSchema>;
  organizationType?: PartnerType;
} {
  return choice === "worker" || choice === "company" ? { kind: choice } : { kind: "company", organizationType: choice };
}

export const emailSchema = z
  .string({ error: "Enter your email address." })
  .trim()
  .toLowerCase()
  .pipe(
    z
      .email({ error: "Enter a valid email address." })
      .max(254, { error: "Email address must be 254 characters or fewer." }),
  );

export const passwordSchema = z
  .string({ error: "Enter a password." })
  .min(PASSWORD_MIN_LENGTH, { error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` })
  .refine(
    (value) => new TextEncoder().encode(value).length <= MAX_PASSWORD_BYTES,
    { error: "Password is too long: use at most 72 characters." },
  );

const signUpSchema = z.object({
  kind: accountKindSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const signUpInputSchema = signUpSchema.extend({
  kind: accountChoiceSchema,
  consents: consentEntriesSchema,
});

export const confirmTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

export const resendSchema = z.object({ email: emailSchema });

// With the partner choices on offer the form asks for an account type; without them it keeps the Phase 1 wording.
export function signUpFormSchema(documents: readonly LegalDocumentSummary[], partners = false) {
  const kind: z.ZodType<AccountChoice, AccountChoice> = partners ? accountChoiceSchema : accountKindSchema;
  return signUpSchema.extend({ kind, accepted: acceptedSchema(documents) });
}

export type SignUpInput = z.input<typeof signUpInputSchema>;
export type SignUpFormInput = z.input<ReturnType<typeof signUpFormSchema>>;
export type SignUpFormOutput = z.output<ReturnType<typeof signUpFormSchema>>;
export type FieldErrors = Record<string, string>;

export function fieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    errors[key] ??= issue.message;
  }
  return errors;
}
