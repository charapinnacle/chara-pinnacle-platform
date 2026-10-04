import { z } from "zod";
import { confirmTokenSchema, emailSchema, passwordSchema } from "@/lib/validation/sign-up";

export const INVALID_CREDENTIALS = "Email or password is incorrect.";

// New passwords are capped at 72 bytes, so a longer entry cannot be anyone's password.
const PASSWORD_MAX = 72;

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: "Enter your password." })
    .min(1, { error: "Enter your password." })
    .max(PASSWORD_MAX, { error: INVALID_CREDENTIALS }),
});

export const loginInputSchema = loginSchema.extend({
  next: z.string().max(2048).optional().catch(undefined),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordFormSchema = z.object({ password: passwordSchema, code: z.string() });

export const resetPasswordInputSchema = z.object({
  tokenHash: confirmTokenSchema,
  password: passwordSchema,
  code: z
    .string()
    .regex(/^\d{6}$/, { error: "Enter the 6-digit code from your authenticator app." })
    .optional(),
});

export type LoginFormInput = z.input<typeof loginSchema>;
export type LoginInput = z.input<typeof loginInputSchema>;
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;
export type ResetPasswordFormInput = z.input<typeof resetPasswordFormSchema>;
export type ResetPasswordInput = z.input<typeof resetPasswordInputSchema>;
