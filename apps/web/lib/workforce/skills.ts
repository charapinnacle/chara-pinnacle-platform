import * as z from "zod";
import { formatCount } from "@/lib/i18n/format";

// The skills of the workers of a listing or a response: a language and its CEFR level, the minimum years of experience
// and a short line of certificates and tests. All optional.
export const cefrLevels = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export const SKILL_CERTIFICATES_MAX = 300;
export const LEVEL_WITHOUT_LANGUAGE = "Choose the language of this level.";

export const skillFields = {
  languageCode: z.string().trim().toLowerCase(),
  languageLevel: z
    .string()
    .trim()
    .refine((value) => value === "" || (cefrLevels as readonly string[]).includes(value), { error: "Choose a level from A1 to C2." }),
  minExperienceYears: z
    .string()
    .trim()
    .refine((value) => value === "" || (/^\d+$/.test(value) && Number(value) <= 50), {
      error: "Enter a number of years from 0 to 50.",
    }),
  certificates: z
    .string()
    .trim()
    .refine((value) => [...value].length <= SKILL_CERTIFICATES_MAX, {
      error: `The certificates and tests must have ${formatCount(SKILL_CERTIFICATES_MAX)} characters or fewer.`,
    })
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), { error: "Remove the control characters." }),
};

export type SkillValues = { languageCode: string; languageLevel: string; minExperienceYears: string; certificates: string };
export const emptySkills: SkillValues = { languageCode: "", languageLevel: "", minExperienceYears: "", certificates: "" };

// The skills as one short line, for example "German B1 · at least 3 years · ISO 9606-1 welders"; null without any.
export function skillsText(skills: {
  language?: string | null;
  languageLevel?: string | null;
  minExperienceYears?: number | null;
  certificates?: string | null;
}): string | null {
  const parts = [
    skills.language ? `${skills.language}${skills.languageLevel ? ` ${skills.languageLevel}` : ""}` : null,
    skills.minExperienceYears == null ? null : `at least ${formatCount(skills.minExperienceYears)} ${skills.minExperienceYears === 1 ? "year" : "years"}`,
    skills.certificates || null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}
