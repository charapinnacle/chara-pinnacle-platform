import { z } from "zod";

export const identifierKindOptions = [
  { value: "registration_number", label: "Company registration number" },
  { value: "vat_number", label: "VAT number" },
  { value: "other", label: "Other legal-entity identifier" },
] as const;

const identifierKindValues: readonly string[] = identifierKindOptions.map((option) => option.value);

const MAX_WEBSITE_LENGTH = 2048;

export function normalizeIdentifier(value: string): string {
  return value.replace(/[\s.\-/]/g, "").toUpperCase();
}

function isWebAddress(value: string): boolean {
  if (value.length > MAX_WEBSITE_LENGTH || !/^https?:\/\/[^/?#\s]/i.test(value) || /\s/.test(value)) return false;
  try {
    return new URL(value).hostname !== "";
  } catch {
    return false;
  }
}

// The form's own schema: every value stays a string, so the form can use it as its resolver.
export const organizationFormSchema = z
  .object({
    legalName: z
      .string({ error: "Enter the legal name of your company." })
      .trim()
      .min(2, { error: "Legal name must be at least 2 characters." })
      .max(200, { error: "Legal name must be 200 characters or fewer." }),
    displayName: z
      .string()
      .trim()
      .max(200, { error: "Display name must be 200 characters or fewer." }),
    country: z
      .string({ error: "Choose the country of your company." })
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, { error: "Choose the country of your company." }),
    industry: z
      .string({ error: "Choose the industry of your company." })
      .trim()
      .toUpperCase()
      .min(1, { error: "Choose the industry of your company." }),
    website: z
      .string()
      .trim()
      .refine((value) => value === "" || isWebAddress(value), {
        error: "Enter a web address that starts with http:// or https://.",
      }),
    identifierKind: z
      .string()
      .trim()
      .refine((value) => value === "" || identifierKindValues.includes(value), {
        error: "Choose the type of identifier.",
      }),
    identifier: z
      .string()
      .trim()
      .max(64, { error: "Identifier must be 64 characters or fewer." }),
  })
  .check((context) => {
    const { identifier, identifierKind } = context.value;
    if (identifier === "") return;
    if (identifierKind === "") {
      context.issues.push({
        code: "custom",
        input: identifierKind,
        path: ["identifierKind"],
        message: "Choose the type of identifier.",
      });
    }
    if (!/^[A-Z0-9]{4,32}$/.test(normalizeIdentifier(identifier))) {
      context.issues.push({
        code: "custom",
        input: identifier,
        path: ["identifier"],
        message: "Enter 4 to 32 letters or digits; spaces, dots, hyphens and slashes are ignored.",
      });
    }
  });

export const organizationInputSchema = organizationFormSchema.transform((value) => ({
  type: "employer" as const,
  legalName: value.legalName,
  displayName: value.displayName === "" ? value.legalName : value.displayName,
  country: value.country,
  industry: value.industry,
  website: value.website === "" ? null : value.website,
  identifier: value.identifier === "" ? null : normalizeIdentifier(value.identifier),
  identifierKind: value.identifier === "" ? null : value.identifierKind,
}));

export type OrganizationFormInput = z.input<typeof organizationFormSchema>;

export const createdOrganizationSchema = z.object({
  organization_id: z.uuid(),
  slug: z.string(),
  duplicate_legal_name: z.boolean(),
});
