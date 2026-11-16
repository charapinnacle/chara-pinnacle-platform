type CompletenessItemKey =
  | "names"
  | "occupation"
  | "skills"
  | "cv"
  | "languages"
  | "experience"
  | "availability"
  | "authorization"
  | "headline"
  | "training"
  | "employmentHistory";

type CompletenessItem = { key: CompletenessItemKey; label: string; rule: string; weight: number; section: string };

// The weights and rules are shown to the candidate as they are (FR-B4, "transparent weights"). The order is the order of
// the suggested next item: by weight, descending, ties in this fixed order. Each list adds up to 100. The Phase 1 list
// applies until release 2c goes live (release_find_workers); from then on the list of FR-Q4 AC7, which adds training and
// employment history (preferred industries and employment types carry no weight). The employer's applicant list stores
// the same percentage when a candidate applies, computed by private.passport_completeness, last defined in
// supabase/migrations/20270201100000_passport_extensions.sql: change the weights and rules in both (pgTAP 069 and 176 and
// completeness.test.ts compare them).
const phaseOneItems: readonly CompletenessItem[] = [
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

const findWorkersItems: readonly CompletenessItem[] = [
  { key: "names", label: "Name and country", rule: "Your first name, last name and country", weight: 10, section: "basics" },
  { key: "occupation", label: "Occupation", rule: "An occupation chosen from the ISCO-08 list", weight: 15, section: "occupation" },
  { key: "cv", label: "CV", rule: "A CV that has passed the file check", weight: 15, section: "documents" },
  { key: "skills", label: "Skills", rule: "At least 3 skills", weight: 10, section: "skills" },
  { key: "languages", label: "Languages", rule: "At least 1 language", weight: 10, section: "languages" },
  { key: "availability", label: "Availability", rule: "Any choice, including unavailable", weight: 10, section: "experience" },
  {
    key: "authorization",
    label: "Work authorisation",
    rule: "At least one country whose authorisation is still valid",
    weight: 10,
    section: "authorizations",
  },
  { key: "experience", label: "Years of experience", rule: "Any number of years, including 0", weight: 5, section: "experience" },
  { key: "headline", label: "Headline", rule: "A headline that is not blank", weight: 5, section: "basics" },
  { key: "training", label: "Training", rule: "At least 1 training entry", weight: 5, section: "training" },
  {
    key: "employmentHistory",
    label: "Employment history",
    rule: "At least 1 employment history entry",
    weight: 5,
    section: "employment-history",
  },
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
  training: readonly unknown[];
  employmentHistory: readonly unknown[];
  hasCv: boolean;
};

export type Completeness = {
  percent: number;
  items: readonly (CompletenessItem & { done: boolean })[];
  next: CompletenessItem | null;
};

// today is a UTC date, YYYY-MM-DD: an authorisation counts until its expiry date has passed. hasCv is true for an
// undeleted CV whose scan status is clean or skipped (hasUsableCv). findWorkersReleased is the release_find_workers switch.
export function computeCompleteness(input: CompletenessInput, today: string, findWorkersReleased: boolean): Completeness {
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
    training: input.training.length >= 1,
    employmentHistory: input.employmentHistory.length >= 1,
  };
  const items = (findWorkersReleased ? findWorkersItems : phaseOneItems).map((item) => ({ ...item, done: done[item.key] }));
  return {
    percent: items.reduce((sum, item) => sum + (item.done ? item.weight : 0), 0),
    items,
    next: items.find((item) => !item.done) ?? null,
  };
}
