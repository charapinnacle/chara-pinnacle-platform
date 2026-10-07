type CompletenessItemKey =
  | "names"
  | "occupation"
  | "skills"
  | "cv"
  | "languages"
  | "experience"
  | "availability"
  | "authorization"
  | "headline";

type CompletenessItem = { key: CompletenessItemKey; label: string; rule: string; weight: number; section: string };

// The weights and rules are shown to the candidate as they are (FR-B4, "transparent weights"). The order is the order of
// the suggested next item: by weight, descending, ties in this fixed order. The weights add up to 100. The employer's
// applicant list stores the same percentage when a candidate applies, computed by private.passport_completeness in
// supabase/migrations/20261027100000_applicant_list.sql: change the weights and rules in both (pgTAP 069 and
// completeness.test.ts compare them).
const completenessItems: readonly CompletenessItem[] = [
  { key: "names", label: "Name and country", rule: "Your first name, last name and country", weight: 10, section: "basics" },
  { key: "occupation", label: "Occupation", rule: "An occupation chosen from the ISCO-08 list", weight: 15, section: "occupation" },
  { key: "skills", label: "Skills", rule: "At least 3 skills", weight: 15, section: "skills" },
  { key: "cv", label: "CV", rule: "A CV that has passed the file check", weight: 15, section: "documents" },
  { key: "languages", label: "Languages", rule: "At least 1 language", weight: 10, section: "languages" },
  { key: "experience", label: "Years of experience", rule: "Any number of years, including 0", weight: 10, section: "experience" },
  { key: "availability", label: "Availability", rule: "Any choice, including unavailable", weight: 10, section: "experience" },
  {
    key: "authorization",
    label: "Work authorisation",
    rule: "At least one country whose authorisation is still valid",
    weight: 10,
    section: "authorizations",
  },
  { key: "headline", label: "Headline", rule: "A headline that is not blank", weight: 5, section: "basics" },
];

const MIN_SKILLS_FOR_SCORE = 3;

const NUDGE_BELOW_PERCENT = 60;

export function showsNudge(percent: number): boolean {
  return percent < NUDGE_BELOW_PERCENT;
}

// The passport as the data layer returns it, with whether the candidate has a usable CV, or any object with these fields.
type CompletenessInput = {
  headline: string | null;
  occupationId: string | null;
  yearsExperience: number | null;
  availability: string | null;
  skills: readonly unknown[];
  languages: readonly unknown[];
  authorizations: readonly { expiresOn: string | null }[];
  hasCv: boolean;
};

export type Completeness = {
  percent: number;
  items: readonly (CompletenessItem & { done: boolean })[];
  next: CompletenessItem | null;
};

// today is a UTC date, YYYY-MM-DD: an authorisation counts until its expiry date has passed. hasCv is true for an
// undeleted CV whose scan status is clean or skipped (hasUsableCv).
export function computeCompleteness(input: CompletenessInput, today: string): Completeness {
  const done: Record<CompletenessItemKey, boolean> = {
    names: true,
    occupation: input.occupationId !== null,
    skills: input.skills.length >= MIN_SKILLS_FOR_SCORE,
    cv: input.hasCv,
    languages: input.languages.length >= 1,
    experience: input.yearsExperience !== null,
    availability: input.availability !== null,
    authorization: input.authorizations.some(({ expiresOn }) => expiresOn === null || expiresOn >= today),
    headline: (input.headline ?? "").trim() !== "",
  };
  const items = completenessItems.map((item) => ({ ...item, done: done[item.key] }));
  return {
    percent: items.reduce((sum, item) => sum + (item.done ? item.weight : 0), 0),
    items,
    next: items.find((item) => !item.done) ?? null,
  };
}
