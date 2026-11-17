import { LinkButton } from "@/components/layout/link-button";
import type { Requirement } from "@/lib/dal/requirements";
import { FIND_WORKERS_DEFAULT_LIMIT, findWorkersQuery } from "@/lib/find-workers/search-params";
import { findWorkersPath } from "@/lib/routes";

// The way from a requirement to Find Workers (FR-Q2 AC10, SOP P2-31 step Open): the search opens with the occupation and
// the destination of the requirement, and cards saved there are kept with it.
export function RequirementFindWorkers({ lang, slug, requirement }: { lang: string; slug: string; requirement: Requirement }) {
  const query = findWorkersQuery({
    requirement: requirement.id,
    occupation: requirement.occupations[0]?.code,
    destination: requirement.countryCode,
    limit: FIND_WORKERS_DEFAULT_LIMIT,
  });
  return (
    <section aria-labelledby="requirement-workers-heading" className="grid gap-3">
      <h2 id="requirement-workers-heading" className="text-h2">
        Workers for this requirement
      </h2>
      <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
        Search the workers who chose to be found, starting with the occupation and destination of this requirement, and save
        the cards that fit.
      </p>
      <div className="flex flex-wrap gap-3">
        <LinkButton href={findWorkersPath(lang, slug, query)} variant="secondary" size="default">
          Find workers for this requirement
        </LinkButton>
      </div>
    </section>
  );
}
