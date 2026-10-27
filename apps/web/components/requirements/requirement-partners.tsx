import { LinkButton } from "@/components/layout/link-button";
import type { Requirement } from "@/lib/dal/requirements";
import { countryInSentence } from "@/lib/i18n/format";
import { requirementPartnersPath } from "@/lib/routes";

// The way from a requirement that needs partners to its suggested partners (FR-M3 step Trigger; FR-M1 AC9): a preview
// while it is a draft, the list once it is published.
export function RequirementPartners({ lang, slug, requirement }: { lang: string; slug: string; requirement: Requirement }) {
  const country = countryInSentence(requirement.countryCode, requirement.country);
  return (
    <section aria-labelledby="requirement-partners-heading" className="grid gap-3">
      <h2 id="requirement-partners-heading" className="text-h2">
        Partners for this requirement
      </h2>
      <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
        {requirement.status === "draft"
          ? `Preview the listed partners that serve ${country} for these occupations. Publish the requirement to work with them.`
          : `See the listed partners that serve ${country} for these occupations, with the reasons each one is suggested.`}
      </p>
      <div className="flex flex-wrap gap-3">
        <LinkButton href={requirementPartnersPath(lang, slug, requirement.id)} variant="secondary" size="default">
          Find partners for this requirement
        </LinkButton>
      </div>
    </section>
  );
}
