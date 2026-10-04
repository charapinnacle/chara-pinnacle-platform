import { z } from "zod";

export const MAX_TOTP_FACTORS = 2;
export const WRONG_CODE = "That code is incorrect or has expired. Try again.";
export const TOO_MANY_FACTORS = "You can register at most two authenticator devices.";
export const AAL2_REQUIRED = "Enter a code from your authenticator app first, then change your devices.";
export const NAME_TAKEN = "You already use this name for another device.";
export const FIRST_FACTOR_NAME = "Authenticator";
export const BACKUP_FACTOR_NAME = "Backup";

const CODE_MESSAGE = "Enter the 6-digit code from your authenticator app.";

// Authenticator apps show the code in two groups of three, so a pasted "123 456" is the same code.
export const totpCodeSchema = z
  .string({ error: CODE_MESSAGE })
  .transform((value) => value.replace(/\s/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, { error: CODE_MESSAGE }));

export const factorNameSchema = z
  .string({ error: "Enter a name for this device." })
  .trim()
  .min(1, { error: "Enter a name for this device." })
  .max(32, { error: "The name must be 32 characters or fewer." });

export const challengeSchema = z.object({ code: totpCodeSchema });
export const codeFormSchema = challengeSchema.extend({ factorId: z.uuid() });
export const enrolmentStartSchema = z.object({ name: factorNameSchema });

const nextSchema = z.string().max(2048).optional().catch(undefined);
export const codeInputSchema = codeFormSchema.extend({ next: nextSchema });

export type CodeFormInput = z.input<typeof codeFormSchema>;
export type CodeInput = z.input<typeof codeInputSchema>;
export type EnrolmentStartInput = z.input<typeof enrolmentStartSchema>;
