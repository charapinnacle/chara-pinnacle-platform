import { EmptyState } from "@/components/feedback/empty-state";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { LinkButton } from "@/components/layout/link-button";
import { searchPartners, type PartnerResult } from "@/lib/dal/partner-search";
import { getCountries } from "@/lib/dal/reference";
import { getCurrentUser } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { viewerOf, type Viewer } from "@/lib/jobs/viewer";
import type { Named } from "@/lib/partners/profile";
import {
  hasPartnerFilters,
  matchedFilterLabels,
  partnerDirectoryPath,
  type PartnerSearchFilters,
} from "@/lib/partners/search-params";
import { partnerProfilePath, signUpPath } from "@/lib/routes";

const names = (items: readonly Named[]) => items.map((item) => item.name).join(", ");

// A card names what an employer decides on and nothing else (FR-L1 AC4, AC8): the partner's own fields, the freshness of
// its capacity and the filters it matched. No badge, score, plan or word of verification [d1.1, d2.5].
function PartnerCard({ lang, partner, basedIn, viewer }: { lang: string; partner: PartnerResult; basedIn: string; viewer: Viewer }) {
  return (
    <li className="grid gap-4 py-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-x-6">
      <div className="grid min-w-0 gap-1">
        <h2 className="text-h2">
          <TextLink href={partnerProfilePath(lang, partner.slug)} className="break-words">
            {partner.displayName}
          </TextLink>
        </h2>
        <p className="text-body text-muted-foreground">Based in {basedIn}</p>
        {partner.servedCountries.length > 0 ? (
          <p className="text-body break-words">Recruits for {names(partner.servedCountries)}</p>
        ) : null}
        {partner.mainOccupations.length > 0 ? (
          <p className="text-body break-words">Main occupations: {names(partner.mainOccupations)}</p>
        ) : null}
        {partner.capacityConfirmedAt ? (
          <p className="text-small text-muted-foreground">
            Capacity confirmed <time dateTime={partner.capacityConfirmedAt}>{formatDate(partner.capacityConfirmedAt)}</time>
          </p>
        ) : null}
        {partner.matchedFilters.length > 0 ? (
          <p className="text-small text-muted-foreground">
            Matches: {partner.matchedFilters.map((name) => matchedFilterLabels[name]).join(", ")}
          </p>
        ) : null}
      </div>
      {/* Save partner, Follow, Send inquiry and Invite to a requirement come with V24, V71 and V41. */}
      {viewer === "visitor" ? (
        <LinkButton href={signUpPath(lang, "company")} variant="secondary">
          Sign up to contact<span className="sr-only"> {partner.displayName}</span>
        </LinkButton>
      ) : null}
    </li>
  );
}

function countText(count: number, hasMore: boolean): string {
  return `${count} recruitment ${count === 1 ? "partner" : "partners"} shown${hasMore ? ", more on the next page" : ""}`;
}

// The results of one address, streamed behind a skeleton by the page; an error here reaches the route's error boundary,
// which toasts and offers a retry (AC10).
export async function PartnerResults({ lang, filters }: { lang: string; filters: PartnerSearchFilters }) {
  const [search, countries, user] = await Promise.all([searchPartners(filters), getCountries(), getCurrentUser()]);

  if (search.state === "rate_limited") {
    return (
      <Notice tone="warning" role="alert">
        <p className="font-semibold">Too many searches, please try again in a minute</p>
      </Notice>
    );
  }
  if (search.state === "advanced_not_in_plan") {
    const basic: PartnerSearchFilters = {
      ...filters,
      capacity: undefined,
      within_days: undefined,
      sources_from: filters.sources_from?.slice(0, 1),
      cursor: undefined,
    };
    return (
      <Notice tone="warning" role="alert">
        <p className="font-semibold">These filters need an employer plan with advanced partner search</p>
        <p>Workforce capacity, availability and several source countries at once are part of the Professional and Enterprise employer plans.</p>
        <p className="mt-2">
          <TextLink standalone href={partnerDirectoryPath(lang, basic)}>
            Search without them
          </TextLink>
        </p>
      </Notice>
    );
  }

  const { results, nextCursor } = search;
  const viewer = viewerOf(user);
  const countryNames = new Map(countries.map(({ code, name }) => [code, name]));
  const filtered = hasPartnerFilters(filters);

  if (results.length === 0) {
    return (
      <div role="status">
        <EmptyState
          title={filtered ? "No recruitment partners match your search" : "No recruitment partners are listed yet"}
          description={filtered ? "Try fewer filters or another destination." : "Check back soon."}
        >
          {filtered ? (
            <TextLink standalone href={partnerDirectoryPath(lang)}>
              Clear filters
            </TextLink>
          ) : null}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <p role="status" aria-live="polite" className="text-body text-muted-foreground">
        {countText(results.length, nextCursor !== null)}
      </p>
      <ul className="animate-stagger divide-y border-y">
        {results.map((partner) => (
          <PartnerCard
            key={partner.id}
            lang={lang}
            partner={partner}
            basedIn={countryNames.get(partner.basedInCountry) ?? partner.basedInCountry}
            viewer={viewer}
          />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-6">
        {nextCursor ? (
          <TextLink standalone href={partnerDirectoryPath(lang, { ...filters, cursor: nextCursor })}>
            Show more partners
          </TextLink>
        ) : null}
        {filters.cursor ? (
          <TextLink standalone href={partnerDirectoryPath(lang, { ...filters, cursor: undefined })}>
            Back to the first page
          </TextLink>
        ) : null}
      </div>
    </div>
  );
}
