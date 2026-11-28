import { LinkButton } from "@/components/layout/link-button";
import type { Requirement } from "@/lib/dal/requirements";
import { charaMatchPath } from "@/lib/routes";
import { charaMatchQuery } from "@/lib/validation/chara-match";

// The way from a requirement to CHARA Match (ARCHITECTURE.md section 9.3): the form opens with the destination, industry,
// first occupation and its quantity, start and recruitment type of the requirement. A start date already past is left
// for the employer to choose.
export function RequirementCharaMatch({ lang, slug, requirement, today }: { lang: string; slug: string; requirement: Requirement; today: string }) {
  const [occupation] = requirement.occupations;
  const query = charaMatchQuery({
    destination: requirement.countryCode,
    industry: requirement.industryCode,
    occupation: occupation?.code,
    workers: String(occupation?.quantity ?? requirement.workersNeeded),
    start: requirement.startDate >= today ? requirement.startDate : undefined,
    recruitment: requirement.recruitmentPreference,
  });
  return (
    <section aria-labelledby="requirement-match-heading" className="grid gap-3">
      <h2 id="requirement-match-heading" className="text-h2">
        CHARA Match
      </h2>
      <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
        See the workers, recruitment partners and staffing partners whose profiles fit this requirement, and why each one
        matches.
      </p>
      <div className="flex flex-wrap gap-3">
        <LinkButton href={charaMatchPath(lang, slug, query)} variant="secondary" size="default">
          Find matches
        </LinkButton>
      </div>
    </section>
  );
}
