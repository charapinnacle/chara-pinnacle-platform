import { EmptyState } from "@/components/feedback/empty-state";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { SaveCardButton } from "@/components/find-workers/save-card-button";
import { WorkerCard, type CardNames } from "@/components/find-workers/worker-card";
import {
  listSavedWorkerCards,
  savedCardIds,
  searchWorkers,
  type FindWorkersRefusal,
  type SavedWorkerCard,
} from "@/lib/dal/find-workers";
import type { WorkerCardData } from "@/lib/find-workers/card";
import { directContactTitles, matchedOnText, resultCountText, type DirectContact } from "@/lib/find-workers/presentation";
import {
  findWorkersCursorError,
  findWorkersQuery,
  hasFindWorkersFilters,
  withoutAdvancedFilters,
  type FindWorkersFilters,
} from "@/lib/find-workers/search-params";
import { RECRUITMENT_DIRECTORY_PATH } from "@/lib/public/navigation";
import { billingPath, companyDashboardPath, findWorkersPath, workforceProfilePath } from "@/lib/routes";

export type FindWorkersContext = {
  lang: string;
  slug: string;
  names: CardNames;
  canManage: boolean;
  partnerSegment: "recruitment" | "staffing" | null;
  requirementId: string | null;
};

const cardLabel = (card: WorkerCardData, names: CardNames) =>
  card.occupation_id ? (names.occupations[card.occupation_id] ?? card.occupation_id) : "Worker";

// What the direct-hiring rules mean for contacting the worker (FR-Q2 AC6, AC10, SOP P2-31 step Rules): nothing to add
// while direct contact is allowed; otherwise why not, with the rule's notice and the way to recruitment partners that
// source from the worker's country.
function ContactRule({ lang, directContact, notice, country, countryName }: {
  lang: string;
  directContact: DirectContact;
  notice: string;
  country: string;
  countryName: string;
}) {
  if (directContact === "allowed") return null;
  return (
    <Notice tone="info">
      <p className="font-semibold">{directContactTitles[directContact]}</p>
      <p className="mt-1">{notice}</p>
      <p className="mt-2">
        <TextLink href={`/${lang}/${RECRUITMENT_DIRECTORY_PATH}?sources_from=${country}`}>
          Find recruitment partners for workers from {countryName}
        </TextLink>
      </p>
    </Notice>
  );
}

type ResultCardProps = {
  card: WorkerCardData;
  directContact: DirectContact;
  notice: string;
  matched: string | null;
  saved: boolean;
  context: FindWorkersContext;
};

function ResultCard({ card, directContact, notice, matched, saved, context }: ResultCardProps) {
  const { lang, slug, names, requirementId } = context;
  return (
    <li className="grid gap-3">
      <WorkerCard card={card} names={names} />
      {matched ? <p className="text-small text-muted-foreground">{matched}</p> : null}
      <ContactRule
        lang={lang}
        directContact={directContact}
        notice={notice}
        country={card.current_country}
        countryName={names.countries[card.current_country] ?? card.current_country}
      />
      <div>
        <SaveCardButton slug={slug} cardId={card.card_id} requirementId={requirementId} saved={saved} cardLabel={cardLabel(card, names)} />
      </div>
    </li>
  );
}

const refusalTexts: Record<FindWorkersRefusal, string> = {
  not_listed: "Find Workers is for companies listed in the partner directories. Yours is not listed yet.",
  profile_hidden: "Our team hid your company profile, so Find Workers is not available to your company.",
  organization_suspended: "Your organisation is suspended, so Find Workers is not available to it.",
  plan_required:
    "Find Workers is part of the paid plans. Companies on a paid plan search workers who chose to be found, by occupation, country, languages, experience and availability. Cards never show a name, a photo or contact details.",
};

// Why the page shows an organisation no workers (FR-Q2 AC1, AC11), with the way forward where there is one.
export function FindWorkersRefusalNotice({ reason, context }: { reason: FindWorkersRefusal; context: FindWorkersContext }) {
  const { lang, slug, canManage, partnerSegment } = context;
  const action =
    reason === "plan_required"
      ? canManage
        ? { href: billingPath(lang, slug), label: "Upgrade your plan" }
        : null
      : reason === "not_listed" && partnerSegment
        ? { href: companyDashboardPath(lang, partnerSegment, slug), label: "See the review of your company" }
        : reason === "profile_hidden"
          ? { href: `${workforceProfilePath(lang, slug)}#moderation-heading`, label: "See the decision" }
          : null;
  return (
    <Notice tone="info" role="status">
      <p>{refusalTexts[reason]}</p>
      {action ? (
        <p className="mt-2">
          <TextLink href={action.href}>{action.label}</TextLink>
        </p>
      ) : reason === "plan_required" ? (
        <p className="mt-2">Ask an owner or admin of your organisation to choose a plan.</p>
      ) : null}
    </Notice>
  );
}

type ResultsProps = {
  organizationId: string;
  filters: FindWorkersFilters;
  context: FindWorkersContext;
  languages: Record<string, string>;
};

// The results of one address, streamed behind a skeleton by the page; an error here reaches the route's error boundary,
// which toasts and offers a retry (FR-Q2 AC10).
export async function FindWorkersResults({ organizationId, filters, context, languages }: ResultsProps) {
  const { lang, slug } = context;
  const [search, saved] = await Promise.all([
    searchWorkers(organizationId, filters),
    savedCardIds(organizationId, context.requirementId),
  ]);
  if (search.state === "rate_limited") {
    return (
      <Notice tone="warning" role="alert">
        <p className="font-semibold">Too many searches. Please wait a minute and try again.</p>
      </Notice>
    );
  }
  if (search.state === "advanced_required") {
    return (
      <Notice tone="warning" role="alert">
        <p className="font-semibold">Skills, languages, experience, industry, employment type and work authorisation filters are available on Professional and Enterprise.</p>
        <p className="mt-2">
          <TextLink href={findWorkersPath(lang, slug, findWorkersQuery({ ...withoutAdvancedFilters(filters), cursor: undefined }))}>
            Search without them
          </TextLink>
        </p>
      </Notice>
    );
  }
  if (search.state === "refused") return <FindWorkersRefusalNotice reason={search.reason} context={context} />;

  const { results, nextCursor, cursorIgnored } = search;
  const ignoredCursor = cursorIgnored ? (
    <Notice tone="warning" role="alert">
      {findWorkersCursorError}
    </Notice>
  ) : null;
  const filtered = hasFindWorkersFilters(filters);
  const clearHref = findWorkersPath(lang, slug, findWorkersQuery({ limit: filters.limit, requirement: filters.requirement }));

  return (
    <section aria-labelledby="find-workers-results-heading" className="grid gap-4">
      <h2 id="find-workers-results-heading" className="sr-only">
        Results
      </h2>
      {ignoredCursor}
      <p role="status" aria-live="polite" className="text-body text-muted-foreground">
        {resultCountText(results.length, nextCursor !== null)}
      </p>
      {results.length === 0 ? (
        <EmptyState
          title={filtered ? "No workers match your search" : "No workers are visible yet"}
          description={
            filtered
              ? "Try fewer filters or another occupation."
              : "Workers appear here once they choose to be found by companies."
          }
        >
          {filtered ? (
            <TextLink standalone href={clearHref}>
              Clear filters
            </TextLink>
          ) : null}
        </EmptyState>
      ) : (
        <ul aria-label="Workers" className="animate-stagger grid gap-6">
          {results.map(({ card, directContact, notice, matchedOn }) => (
            <ResultCard
              key={card.card_id}
              card={card}
              directContact={directContact}
              notice={notice}
              matched={matchedOnText(matchedOn, { ...filters, languages })}
              saved={saved.has(card.card_id)}
              context={context}
            />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-x-6">
        {nextCursor ? (
          <TextLink standalone href={findWorkersPath(lang, slug, findWorkersQuery({ ...filters, cursor: nextCursor }))}>
            Show more workers
          </TextLink>
        ) : null}
        {filters.cursor && !cursorIgnored ? (
          <TextLink standalone href={findWorkersPath(lang, slug, findWorkersQuery({ ...filters, cursor: undefined }))}>
            Back to the first page
          </TextLink>
        ) : null}
      </div>
    </section>
  );
}

function SavedCard({ saved, context }: { saved: SavedWorkerCard; context: FindWorkersContext }) {
  if (!saved.visible) {
    return (
      <li className="grid gap-3 rounded-lg border p-4">
        <p className="text-body">This worker is no longer visible.</p>
        <div>
          <SaveCardButton slug={context.slug} cardId={saved.cardId} requirementId={context.requirementId} saved cardLabel="worker no longer visible" />
        </div>
      </li>
    );
  }
  return (
    <ResultCard card={saved.card} directContact={saved.directContact} notice={saved.notice} matched={null} saved context={context} />
  );
}

// The cards saved for the requirement the search was opened from, or for the organisation (FR-Q2 AC12, SOP step Act).
export async function SavedWorkers({ organizationId, context }: { organizationId: string; context: FindWorkersContext }) {
  const saved = await listSavedWorkerCards(organizationId, context.requirementId);
  return (
    <section aria-labelledby="saved-workers-heading" className="grid gap-3">
      <h2 id="saved-workers-heading" className="text-h2">
        {context.requirementId ? "Saved for this requirement" : "Saved workers"}
      </h2>
      {saved.length === 0 ? (
        <p className="text-body text-muted-foreground">No saved workers yet. Press Save on a card to keep it here.</p>
      ) : (
        <ul aria-label="Saved workers" className="grid gap-6">
          {saved.map((item) => (
            <SavedCard key={item.cardId} saved={item} context={context} />
          ))}
        </ul>
      )}
    </section>
  );
}
