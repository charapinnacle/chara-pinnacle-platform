import * as z from "zod";
import { salaryPeriods } from "@/lib/validation/job";
import { OCCUPATIONS_MAX, type RequirementFormInput } from "@/lib/validation/requirement";

export { clearRequirementDrafts, requirementDraftKey } from "./draft-keys";

// What a new requirement keeps in this tab until it is saved (FR-M1 AC12): a draft row needs every field, so a
// half-filled form is kept in the browser, never on the server. Only the values of the form, keyed by the user and the
// organisation, so another account in the same tab never sees them; log out removes them all. Unreadable or blocked
// storage only costs the convenience of a restored draft.
const draftSchema = z.object({
  title: z.string(),
  workersNeeded: z.string(),
  country: z.string(),
  cityRegion: z.string(),
  industry: z.string(),
  occupations: z.array(z.object({ occupation: z.string(), quantity: z.string() })).min(1).max(OCCUPATIONS_MAX),
  skills: z.string(),
  experienceYears: z.string(),
  startDate: z.string(),
  durationMonths: z.string(),
  employmentType: z.string(),
  salaryMin: z.string(),
  salaryMax: z.string(),
  salaryCurrency: z.string(),
  salaryPeriod: z.union([z.literal(""), z.enum(salaryPeriods)]),
  accommodation: z.boolean(),
  workPermitSupport: z.boolean(),
  visaSupport: z.boolean(),
  recruitmentPreference: z.string(),
  partnerNeed: z.string(),
});

export function readRequirementDraft(key: string): RequirementFormInput | null {
  try {
    const stored = window.sessionStorage.getItem(key);
    if (!stored) return null;
    const parsed = draftSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeRequirementDraft(key: string, values: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(values));
  } catch {
    // See the note above: the draft is a convenience.
  }
}

export function clearRequirementDraft(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // As writeRequirementDraft.
  }
}
