import { Card } from "@/components/layout/card";
import {
  employmentTypeText,
  experienceText,
  periodText,
  type WorkerCardData,
} from "@/lib/find-workers/card";
import { formatDate } from "@/lib/i18n/format";

// The names of the codes a card holds, from the reference lists.
export type CardNames = {
  countries: Record<string, string>;
  occupations: Record<string, string>;
  languages: Record<string, string>;
  industries: Record<string, string>;
};

type WorkerCardProps = {
  card: WorkerCardData;
  names: CardNames;
  headingLevel?: "h3" | "h4";
};

function namesOf(codes: readonly string[], lookup: Record<string, string>): string {
  return codes.map((code) => lookup[code] ?? code).join(", ");
}

function availabilityText(card: WorkerCardData): string | null {
  if (card.availability === "now") return "Available now";
  if (card.availability === "from_date" && card.available_from) return `Available from ${formatDate(card.available_from)}`;
  if (card.availability === "unavailable") return "Not available at the moment";
  return null;
}

function Detail({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-small text-muted-foreground">{term}</dt>
      <dd className="text-body">{children}</dd>
    </div>
  );
}

// The pseudonymous Find Workers card (FR-Q1, NFR-S9): what a company sees of a visible worker, and what the worker's own
// preview shows. It has no name, photo, contact detail or document, because the card data has none; the optional
// sections appear only when the data carries them (the worker allowed them).
export function WorkerCard({ card, names, headingLevel: Heading = "h3" }: WorkerCardProps) {
  const occupation = card.occupation_id ? (names.occupations[card.occupation_id] ?? card.occupation_id) : "Occupation not set";
  const experience = experienceText(card.years_experience);
  const availability = availabilityText(card);
  return (
    <Card as="div" padding="lg" className="gap-4" data-testid="worker-card">
      <div className="grid gap-1">
        <Heading className="text-h3">{occupation}</Heading>
        {card.headline ? <p className="text-body text-muted-foreground">{card.headline}</p> : null}
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        {experience ? <Detail term="Experience">{experience}</Detail> : null}
        {availability ? <Detail term="Availability">{availability}</Detail> : null}
        <Detail term="Lives in">{names.countries[card.current_country] ?? card.current_country}</Detail>
        {card.languages.length > 0 ? (
          <Detail term="Languages">
            {card.languages.map((language) => `${names.languages[language.code] ?? language.code} (${language.level})`).join(", ")}
          </Detail>
        ) : null}
        {card.skills.length > 0 ? <Detail term="Skills">{card.skills.join(", ")}</Detail> : null}
        {card.preferred_countries.length > 0 ? (
          <Detail term="Preferred countries">{namesOf(card.preferred_countries, names.countries)}</Detail>
        ) : null}
        {card.work_authorization_countries.length > 0 ? (
          <Detail term="May work in">{namesOf(card.work_authorization_countries, names.countries)}</Detail>
        ) : null}
        {card.preferred_industries ? (
          <Detail term="Preferred industries">
            {card.preferred_industries.length > 0 ? namesOf(card.preferred_industries, names.industries) : "None added"}
          </Detail>
        ) : null}
        {card.preferred_employment_types && card.preferred_employment_types.length > 0 ? (
          <Detail term="Preferred employment types">{employmentTypeText(card.preferred_employment_types)}</Detail>
        ) : null}
      </dl>
      {card.training ? (
        <div className="grid gap-1">
          <Heading className="text-body font-medium">Training</Heading>
          {card.training.length > 0 ? (
            <ul className="grid gap-1 text-body">
              {card.training.map((entry, index) => (
                <li key={`${entry.course}-${entry.year_completed}-${index}`}>
                  {entry.course}
                  {entry.provider ? `, ${entry.provider}` : ""} ({entry.year_completed})
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-muted-foreground">None added</p>
          )}
        </div>
      ) : null}
      {card.employment_history ? (
        <div className="grid gap-1">
          <Heading className="text-body font-medium">Employment history</Heading>
          {card.employment_history.length > 0 ? (
            <ul className="grid gap-1 text-body">
              {card.employment_history.map((entry, index) => (
                <li key={`${entry.role}-${entry.from_month}-${index}`}>
                  {entry.role} in {names.countries[entry.country_code] ?? entry.country_code}, {periodText(entry.from_month, entry.to_month)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-muted-foreground">None added</p>
          )}
        </div>
      ) : null}
    </Card>
  );
}
