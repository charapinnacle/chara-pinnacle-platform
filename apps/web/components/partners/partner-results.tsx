import { ConnectionActions } from "@/components/connections/connection-actions";
import { EmptyState } from "@/components/feedback/empty-state";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { LinkButton } from "@/components/layout/link-button";
import { hasConnectionActions, type ConnectionAccess } from "@/lib/connections/access";
import { getConnectionStates } from "@/lib/dal/connections";
import { searchPartners, type PartnerResult } from "@/lib/dal/partner-search";
import { getCountries } from "@/lib/dal/reference";
import { getCurrentUser } from "@/lib/dal/session";
import { formatCount, formatDate } from "@/lib/i18n/format";
import { viewerOf, type Viewer } from "@/lib/jobs/viewer";
import type { Named } from "@/lib/partners/profile";
import {
  hasPartnerFilters,
  matchedFilterLabels,
  partnerDirectoryPath,
  type PartnerDirectoryKind,
  type PartnerSearchFilters,
} from "@/lib/partners/search-params";
import { loginPath, partnerProfilePath } from "@/lib/routes";
import { staffingTypeLabels } from "@/lib/validation/workforce-offer";

const names = (items: readonly Named[]) => items.map((item) => item.name).join(", ");

type Connection = { access: ConnectionAccess; saved: boolean; following: boolean };

type CardProps = {
  lang: string;
  kind: PartnerDirectoryKind;
  partner: PartnerResult;
  basedIn: string;
  viewer: Viewer;
  connection: Connection;
};

// A card names what an employer decides on and nothing else (FR-L1 AC4, AC8; FR-L2 AC6): the partner's own fields, the
// freshness of its capacity and the filters it matched. A staffing card adds its staffing types and the workers of its
// fresh listings per occupation, each with its confirmation date, and marks a recruitment company that also offers
// staffing. No badge, score, plan or word of verification [d1.1, d2.5].
function PartnerCard({ lang, kind, partner, basedIn, viewer, connection }: CardProps) {
  const staffing = kind === "staffing";
  const profilePath = partnerProfilePath(lang, partner.slug);
  return (
    <li className="grid gap-4 py-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-x-6">
      <div className="grid min-w-0 gap-1">
        <h2 className="text-h2">
          <TextLink href={profilePath} className="break-words">
            {partner.displayName}
          </TextLink>
        </h2>
        {staffing && partner.alsoOffersStaffing ? (
          <p className="text-small text-muted-foreground">Recruitment company, also offers staffing</p>
        ) : null}
        <p className="text-body text-muted-foreground">Based in {basedIn}</p>
        {partner.servedCountries.length > 0 ? (
          <p className="text-body break-words">
            {staffing ? "Markets served: " : "Recruits for "}
            {names(partner.servedCountries)}
          </p>
        ) : null}
        {staffing && partner.staffingTypes.length > 0 ? (
          <p className="text-body">
            Staffing types:{" "}
            {partner.staffingTypes.flatMap((type) => (type === "staffing" ? [] : [staffingTypeLabels[type]])).join(", ")}
          </p>
        ) : null}
        {partner.mainOccupations.length > 0 ? (
          <p className="text-body break-words">Main occupations: {names(partner.mainOccupations)}</p>
        ) : null}
        {staffing && partner.availableWorkforce === null ? (
          <p className="text-small text-muted-foreground">
            <TextLink href={loginPath(lang, profilePath)}>
              Sign in<span className="sr-only"> to see the available workforce of {partner.displayName}</span>
            </TextLink>{" "}
            <span aria-hidden>to see the available workforce</span>
          </p>
        ) : null}
        {staffing && partner.availableWorkforce && partner.availableWorkforce.length > 0 ? (
          <ul aria-label={`Available workforce of ${partner.displayName}`} className="grid gap-0.5 text-body">
            {partner.availableWorkforce.map((item) => (
              <li key={item.occupation} className="break-words">
                {item.occupation}: {formatCount(item.available)} available, confirmed{" "}
                <time dateTime={item.confirmedAt}>{formatDate(item.confirmedAt)}</time>
              </li>
            ))}
          </ul>
        ) : null}
        {!staffing && partner.capacityConfirmedAt ? (
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
      {viewer === "visitor" || hasConnectionActions(connection.access) ? (
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {viewer === "visitor" ? (
            <LinkButton href={loginPath(lang, profilePath)} variant="secondary">
              Sign in to contact<span className="sr-only normal-case"> {partner.displayName}</span>
            </LinkButton>
          ) : null}
          <ConnectionActions
            lang={lang}
            organizationId={partner.id}
            name={partner.displayName}
            access={connection.access}
            saved={connection.saved}
            following={connection.following}
            next={profilePath}
          />
        </div>
      ) : null}
    </li>
  );
}

function countText(kind: PartnerDirectoryKind, count: number, hasMore: boolean): string {
  return `${count} ${kind} ${count === 1 ? "partner" : "partners"} shown${hasMore ? ", more on the next page" : ""}`;
}

// The results of one address, streamed behind a skeleton by the page; an error here reaches the route's error boundary,
// which toasts and offers a retry (FR-L1 AC10, FR-L2 AC10).
export async function PartnerResults({ lang, kind, filters }: { lang: string; kind: PartnerDirectoryKind; filters: PartnerSearchFilters }) {
  const [search, countries, user] = await Promise.all([searchPartners(kind, filters), getCountries(), getCurrentUser()]);
  const otherKind: PartnerDirectoryKind = kind === "staffing" ? "recruitment" : "staffing";

  if (search.state === "rate_limited") {
    return (
      <Notice tone="warning" role="alert">
        <p className="font-semibold">Too many searches. Please wait a minute and try again.</p>
      </Notice>
    );
  }
  const basic: PartnerSearchFilters = {
    ...filters,
    capacity: undefined,
    within_days: undefined,
    sources_from: filters.sources_from?.slice(0, 1),
    cursor: undefined,
  };
  if (search.state === "advanced_needs_sign_in") {
    return (
      <Notice tone="warning" role="alert">
        <p className="font-semibold">Sign in to filter by workforce capacity.</p>
        <p>
          {kind === "staffing"
            ? "Capacity and availability are shown to signed-in companies only."
            : "Capacity, availability and several source countries at once are for signed-in companies only."}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-6">
          <TextLink standalone href={loginPath(lang, partnerDirectoryPath(lang, kind, filters))}>
            Sign in
          </TextLink>
          <TextLink standalone href={partnerDirectoryPath(lang, kind, basic)}>
            Search without them
          </TextLink>
        </div>
      </Notice>
    );
  }
  if (search.state === "advanced_not_in_plan") {
    return (
      <Notice tone="warning" role="alert">
        <p className="font-semibold">These filters need a plan with advanced partner search.</p>
        <p>
          {kind === "staffing"
            ? "Capacity and availability are not in your plan."
            : "Capacity, availability and several source countries at once are not in your plan."}
        </p>
        <p className="mt-2">
          <TextLink standalone href={partnerDirectoryPath(lang, kind, basic)}>
            Search without them
          </TextLink>
        </p>
      </Notice>
    );
  }

  const { results, nextCursor } = search;
  const viewer = viewerOf(user);
  const connections = await getConnectionStates(results.map(({ id, organizationType }) => ({ id, type: organizationType })));
  const countryNames = new Map(countries.map(({ code, name }) => [code, name]));
  const filtered = hasPartnerFilters(filters);

  if (results.length === 0) {
    return (
      <div role="status">
        <EmptyState
          title={
            filtered ? `No ${kind} partners match your search` : `No ${kind} partners are listed yet`
          }
          description={filtered ? "Try fewer filters or another destination." : "Check back soon."}
        >
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            {filtered ? (
              <TextLink standalone href={partnerDirectoryPath(lang, kind)}>
                Clear filters
              </TextLink>
            ) : null}
            <TextLink standalone href={partnerDirectoryPath(lang, otherKind)}>
              {otherKind === "staffing" ? "Find Staffing Partners" : "Find Recruitment Partners"}
            </TextLink>
          </div>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <p role="status" aria-live="polite" className="text-body text-muted-foreground">
        {countText(kind, results.length, nextCursor !== null)}
      </p>
      <ul className="animate-stagger divide-y border-y">
        {results.map((partner) => (
          <PartnerCard
            key={partner.id}
            lang={lang}
            kind={kind}
            partner={partner}
            basedIn={countryNames.get(partner.basedInCountry) ?? partner.basedInCountry}
            viewer={viewer}
            connection={{
              access: connections.access.get(partner.id) ?? { kind: "none" },
              saved: connections.saved.has(partner.id),
              following: connections.followed.has(partner.id),
            }}
          />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-6">
        {nextCursor ? (
          <TextLink standalone href={partnerDirectoryPath(lang, kind, { ...filters, cursor: nextCursor })}>
            Show more partners
          </TextLink>
        ) : null}
        {filters.cursor ? (
          <TextLink standalone href={partnerDirectoryPath(lang, kind, { ...filters, cursor: undefined })}>
            Back to the first page
          </TextLink>
        ) : null}
      </div>
    </div>
  );
}
