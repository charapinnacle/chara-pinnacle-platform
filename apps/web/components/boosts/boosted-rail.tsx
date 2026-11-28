import { StatusBadge } from "@/components/feedback/status-badge";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { BOOSTED_LABEL, railNote } from "@/lib/boosts/presentation";
import { getBoostedPartners } from "@/lib/dal/boosts";
import { getCountries } from "@/lib/dal/reference";
import type { Named } from "@/lib/partners/profile";
import type { PartnerDirectoryKind, PartnerSearchFilters } from "@/lib/partners/search-params";
import { partnerProfilePath } from "@/lib/routes";
import { staffingTypeLabels } from "@/lib/validation/workforce-offer";

const names = (items: readonly Named[]) => items.map((item) => item.name).join(", ");

// The paid placement of a directory (ARCHITECTURE.md section 10.5): a region of its own above the organic results, each
// card labelled Boosted, with the line that says what it is. It reads only the boosts, never a trust signal, and the
// organic results never read it. No boosted partner matching the search means no rail at all. A failed read hides the
// rail and leaves the results, which matter more, to load on their own.
export async function BoostedRail({ lang, kind, filters }: { lang: string; kind: PartnerDirectoryKind; filters: PartnerSearchFilters }) {
  const [partners, countries] = await Promise.all([
    getBoostedPartners(kind, filters).catch((error: unknown) => {
      console.error("The boosted rail could not be loaded", error);
      return [];
    }),
    getCountries(),
  ]);
  if (partners.length === 0) return null;
  const countryNames = new Map(countries.map(({ code, name }) => [code, name]));

  return (
    <section aria-labelledby="boosted-heading" className="grid gap-3 rounded-xl border border-dashed p-4">
      <div className="grid gap-1">
        <h2 id="boosted-heading" className="text-h3">
          {BOOSTED_LABEL} companies
        </h2>
        <p className="text-small text-muted-foreground">{railNote}</p>
      </div>
      <ul className="grid gap-3 md:grid-cols-3">
        {partners.map((partner) => (
          <Card as="li" key={partner.id} padding="sm" className="min-w-0 gap-1">
            <StatusBadge status="neutral" className="justify-self-start">
              {BOOSTED_LABEL}
            </StatusBadge>
            <h3 className="font-medium">
              <TextLink href={partnerProfilePath(lang, partner.slug)} className="break-words">
                {partner.displayName}
              </TextLink>
            </h3>
            <p className="text-small text-muted-foreground">
              Based in {countryNames.get(partner.basedInCountry) ?? partner.basedInCountry}
            </p>
            {partner.servedCountries.length > 0 ? (
              <p className="text-small break-words">
                {kind === "staffing" ? "Markets served: " : "Recruits for "}
                {names(partner.servedCountries)}
              </p>
            ) : null}
            {kind === "staffing" && partner.staffingTypes.length > 0 ? (
              <p className="text-small">
                Staffing types:{" "}
                {partner.staffingTypes.flatMap((type) => (type === "staffing" ? [] : [staffingTypeLabels[type]])).join(", ")}
              </p>
            ) : null}
            {partner.mainOccupations.length > 0 ? (
              <p className="text-small break-words">Occupations: {names(partner.mainOccupations)}</p>
            ) : null}
          </Card>
        ))}
      </ul>
    </section>
  );
}
