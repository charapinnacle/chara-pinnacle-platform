type CompletenessItemKey =
  | "names"
  | "occupation"
  | "skills"
  | "languages"
  | "experience"
  | "availability"
  | "authorization"
  | "headline";

type CompletenessItem = { key: CompletenessItemKey; label: string; weight: number; section: string };

// Weights follow FR-B4; the CV item (15) joins when documents exist. The order is the order of the suggested next item:
// by weight, descending, ties in this fixed order.
const completenessItems: readonly CompletenessItem[] = [
  { key: "names", label: "Name and country", weight: 10, section: "basics" },
  { key: "occupation", label: "Occupation", weight: 15, section: "occupation" },
  { key: "skills", label: "Skills", weight: 15, section: "skills" },
  { key: "languages", label: "Languages", weight: 10, section: "languages" },
  { key: "experience", label: "Years of experience", weight: 10, section: "experience" },
  { key: "availability", label: "Availability", weight: 10, section: "experience" },
  { key: "authorization", label: "Work authorisation", weight: 10, section: "authorizations" },
  { key: "headline", label: "Headline", weight: 5, section: "basics" },
];

const MIN_SKILLS_FOR_SCORE = 3;

// The passport as the data layer returns it, or any object with these fields.
type CompletenessInput = {
  headline: string | null;
  occupationId: string | null;
  yearsExperience: number | null;
  availability: string | null;
  skills: readonly unknown[];
  languages: readonly unknown[];
  authorizations: readonly { expiresOn: string | null }[];
};

export type Completeness = {
  percent: number;
  items: readonly (CompletenessItem & { done: boolean })[];
  next: CompletenessItem | null;
};

// today is a UTC date, YYYY-MM-DD: an authorisation counts until its expiry date has passed.
export function computeCompleteness(input: CompletenessInput, today: string): Completeness {
  const done: Record<CompletenessItemKey, boolean> = {
    names: true,
    occupation: input.occupationId !== null,
    skills: input.skills.length >= MIN_SKILLS_FOR_SCORE,
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
