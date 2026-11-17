import { EmptyState } from "@/components/feedback/empty-state";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { InviteToJob } from "@/components/connections/invite-to-job";
import { SendContactRequest } from "@/components/contact-requests/send-contact-request";
import { SaveCardButton } from "@/components/find-workers/save-card-button";
import { WorkerCard, type CardNames } from "@/components/find-workers/worker-card";
import { sentStatusLabels } from "@/lib/contact-requests/presentation";
import { cardContactRequests, type CardContactState, type OpenVacancy } from "@/lib/dal/contact-requests";
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
import { formatDate } from "@/lib/i18n/format";
import { RECRUITMENT_DIRECTORY_PATH } from "@/lib/public/navigation";
import { billingPath, companyDashboardPath, findWorkersPath, orgContactRequestsPath, workforceProfilePath } from "@/lib/routes";

export type FindWorkersContext = {
  lang: string;
  slug: string;
  names: CardNames;
  canManage: boolean;
  partnerSegment: "recruitment" | "staffing" | null;
  requirementId: string | null;
  // The requirement's country, which list_saved_worker_cards reads the rules for.
  requirementCountry: string | null;
  // The open vacancies a contact request may invite the worker to (an employer's; none for a partner).
  vacancies: readonly OpenVacancy[];
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

// Contacting the worker (FR-Q3 AC12): "Send contact request" while the rules allow direct contact and the organisation may
// send one; once a request stops it, the date it was sent and how it stands, linked to the organisation's requests. Once
// the worker accepted, Invite to job sends an invitation to apply in their conversation (FR-P2 step Invite to job, V71).
function ContactAction({ card, directContact, destination, contact, context }: {
  card: WorkerCardData;
  directContact: DirectContact;
  destination: string | null;
  contact: CardContactState | undefined;
  context: FindWorkersContext;
}) {
  const { lang, slug, names, vacancies } = context;
  if (contact && !contact.canSend) {
    return (
      <div className="grid gap-2 text-small text-muted-foreground">
        <p>
        Request sent on <time dateTime={contact.sentAt}>{formatDate(contact.sentAt)}</time> ·{" "}
        <TextLink href={orgContactRequestsPath(lang, slug)}>{sentStatusLabels[contact.status]}</TextLink>
        </p>
        {contact.status === "accepted" ? (
          <InviteToJob slug={slug} target={{ contactRequestId: contact.requestId }} workerLabel={cardLabel(card, names)} vacancies={vacancies} />
        ) : null}
      </div>
    );
  }
  if (directContact !== "allowed") return null;
  return <SendContactRequest slug={slug} cardId={card.card_id} cardLabel={cardLabel(card, names)} destination={destination} vacancies={vacancies} />;
}

type ResultCardProps = {
  card: WorkerCardData;
  directContact: DirectContact;
  // The destination the rules of directContact were read for (null: the organisation's country).
  destination: string | null;
  notice: string;
  matched: string | null;
  saved: boolean;
  contact: CardContactState | undefined;
  context: FindWorkersContext;
};

function ResultCard({ card, directContact, destination, notice, matched, saved, contact, context }: ResultCardProps) {
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
      <div className="flex flex-wrap items-center gap-3">
        <ContactAction card={card} directContact={directContact} destination={destination} contact={contact} context={context} />
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
  const contacts = await cardContactRequests(organizationId, results.map(({ card }) => card.card_id));
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
              destination={filters.destination ?? null}
              notice={notice}
              matched={matchedOnText(matchedOn, { ...filters, languages, countries: context.names.countries })}
              saved={saved.has(card.card_id)}
              contact={contacts.get(card.card_id)}
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

function SavedCard({ saved, contact, context }: { saved: SavedWorkerCard; contact: CardContactState | undefined; context: FindWorkersContext }) {
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
    <ResultCard
      card={saved.card}
      directContact={saved.directContact}
      destination={context.requirementCountry}
      notice={saved.notice}
      matched={null}
      saved
      contact={contact}
      context={context}
    />
  );
}

// The cards saved for the requirement the search was opened from, or for the organisation (FR-Q2 AC12, SOP step Act).
export async function SavedWorkers({ organizationId, context }: { organizationId: string; context: FindWorkersContext }) {
  const saved = await listSavedWorkerCards(organizationId, context.requirementId);
  const contacts = await cardContactRequests(
    organizationId,
    saved.filter((item) => item.visible).map((item) => item.cardId),
  );
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
            <SavedCard key={item.cardId} saved={item} contact={contacts.get(item.cardId)} context={context} />
          ))}
        </ul>
      )}
    </section>
  );
}
