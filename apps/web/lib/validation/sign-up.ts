import * as z from "zod";
import {
  acceptedSchema,
  consentEntriesSchema,
  type LegalDocumentSummary,
} from "@/lib/validation/consents";

const MAX_PASSWORD_BYTES = 72;

export const accountKindSchema = z.enum(["worker", "company"], {
  error: "Choose worker or employer",
});

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
  .min(12, { error: "Password must be at least 12 characters." })
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
  consents: consentEntriesSchema,
});

export const confirmTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

export const resendSchema = z.object({ email: emailSchema });

export function signUpFormSchema(documents: readonly LegalDocumentSummary[]) {
  return signUpSchema.extend({ accepted: acceptedSchema(documents) });
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
