import { ConnectionActions } from "@/components/connections/connection-actions";
import { EmptyState } from "@/components/feedback/empty-state";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { DeleteSavedSearchButton } from "@/components/find-employers/delete-saved-search-button";
import type { ConnectionAccess } from "@/lib/connections/access";
import { getConnectionStates } from "@/lib/dal/connections";
import { listSavedSearches, searchEmployers, type EmployerJobOrder, type EmployerResult, type FindEmployersRefusal } from "@/lib/dal/find-employers";
import {
  anonymousJobOrderText,
  jobOrderCountText,
  resultCountText,
  savedSearchText,
  vacancyCountText,
  type ReferenceNames,
} from "@/lib/find-employers/presentation";
import { FIND_EMPLOYERS_DEFAULT_LIMIT, findEmployersCursorError, findEmployersQuery, hasFindEmployersFilters, type FindEmployersFilters } from "@/lib/find-employers/search-params";
import { COMPANY_NOT_NAMED, reasonOf } from "@/lib/job-orders/presentation";
import { workersText } from "@/lib/requirements/presentation";
import {
  billingPath,
  companyDashboardPath,
  companyPagePath,
  findEmployersPath,
  jobOrderPath,
  workforceProfilePath,
} from "@/lib/routes";

export type FindEmployersContext = { lang: string; slug: string; names: ReferenceNames; canManage: boolean };

// One job order of a result as the database returned it: the title links the job order page; a reduced one names its
// destination, size and what the partner is missing, with the link that fixes it.
function JobOrderLine({ order, context }: { order: EmployerJobOrder; context: FindEmployersContext }) {
  const { lang, slug, names, canManage } = context;
  const country = names.countries.get(order.countryCode) ?? order.countryCode;
  return (
    <li className="grid gap-1">
      <TextLink href={jobOrderPath(lang, slug, order.id)} className="break-words">
        {order.title}
      </TextLink>
      <span className="text-small text-muted-foreground">
        {country} · {workersText(order.workersNeeded)}
      </span>
      {order.eligible
        ? null
        : order.reasons.map((reason) => {
            const { text, action } = reasonOf(reason, { lang, slug, country, canManage });
            return (
              <span key={reason} className="text-small">
                {text} {action ? <TextLink href={action.href}>{action.label}</TextLink> : null}
              </span>
            );
          })}
    </li>
  );
}

type Company = Extract<EmployerResult, { kind: "company" }>;
type Connection = { access: ConnectionAccess; following: boolean };

// A company (FR-L3 AC7): its name links its company page only while that page is public; its job orders that fit; its
// public vacancies; Follow for a public page. Nothing here comes from anything but search_employers, so no contact
// detail, member or legal name can appear (AC10).
function CompanyCard({ company, context, connection }: { company: Company; context: FindEmployersContext; connection: Connection | null }) {
  const { lang, names } = context;
  const facts = [
    company.industryCode ? (names.industries.get(company.industryCode) ?? company.industryCode) : null,
    company.basedInCountry ? (names.countries.get(company.basedInCountry) ?? company.basedInCountry) : null,
    company.openVacancyCount !== null ? vacancyCountText(company.openVacancyCount) : null,
  ].filter((fact) => fact !== null);
  return (
    <li className="grid gap-3 py-6 sm:grid-cols-[1fr_auto]">
      <div className="grid gap-2">
        <h2 className="text-h2 break-words">
          {company.slug ? <TextLink href={companyPagePath(lang, company.slug)}>{company.displayName}</TextLink> : company.displayName}
        </h2>
        {facts.length > 0 ? <p className="text-body text-muted-foreground">{facts.join(" · ")}</p> : null}
        {company.jobOrderCount > 0 ? (
          <>
            <p className="text-body">
              {jobOrderCountText(company.jobOrderCount)}
              {company.jobOrderCount > company.jobOrders.length ? `, the ${company.jobOrders.length} newest shown` : ""}
            </p>
            <ul className="grid gap-3" aria-label={`Job orders of ${company.displayName}`}>
              {company.jobOrders.map((order) => (
                <JobOrderLine key={order.id} order={order} context={context} />
              ))}
            </ul>
          </>
        ) : null}
      </div>
      {connection ? (
        <div className="sm:justify-self-end">
          <ConnectionActions
            lang={lang}
            organizationId={company.employerId}
            name={company.displayName}
            access={connection.access}
            saved={false}
            following={connection.following}
            next={findEmployersPath(lang, context.slug)}
          />
        </div>
      ) : null}
    </li>
  );
}

// A job order whose employer is not named to this partner (decision 3.2, NFR-S11): "Company not named", the industry and
// the neutral title, and the way to the job order; no Follow, since nothing says whom to follow.
function AnonymousJobOrderCard({ order, context }: { order: EmployerJobOrder; context: FindEmployersContext }) {
  const { lang, slug, names, canManage } = context;
  const country = names.countries.get(order.countryCode) ?? order.countryCode;
  return (
    <li className="grid gap-2 py-6">
      <h2 className="text-h2">{COMPANY_NOT_NAMED}</h2>
      <p className="text-body break-words">{anonymousJobOrderText(order.title, order.industryCode, names)}</p>
      {order.eligible ? null : (
        <ul className="grid gap-1 text-body" aria-label={`Why only the title of ${order.title} is shown`}>
          {order.reasons.map((reason) => {
            const { text, action } = reasonOf(reason, { lang, slug, country, canManage });
            return (
              <li key={reason}>
                {text} {action ? <TextLink href={action.href}>{action.label}</TextLink> : null}
              </li>
            );
          })}
        </ul>
      )}
      <p>
        <TextLink href={jobOrderPath(lang, slug, order.id)}>
          Open job order<span className="sr-only">: {order.title}</span>
        </TextLink>
      </p>
    </li>
  );
}

const refusalTexts: Record<FindEmployersRefusal, string> = {
  not_listed: "Find Employers is for companies listed in the partner directories. Yours is not listed yet.",
  profile_hidden: "Our team hid your company profile, so Find Employers is not available to your company.",
  organization_suspended: "Your company is suspended, so Find Employers is not available to it.",
  plan_required: "Find Employers is part of the paid partner plans. Choose a plan to search employers and their job orders.",
};

// Why the page shows a company no results (FR-L3 AC1, AC8), with the way forward where there is one.
export function FindEmployersRefusalNotice({ reason, context }: { reason: FindEmployersRefusal; context: FindEmployersContext }) {
  const { lang, slug, canManage } = context;
  const action =
    reason === "plan_required"
      ? canManage
        ? { href: billingPath(lang, slug), label: "Choose a plan" }
        : null
      : reason === "not_listed"
        ? { href: companyDashboardPath(lang, "recruitment", slug), label: "See the review of your company" }
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
        <p className="mt-2">Ask an owner or admin of your company to choose a plan.</p>
      ) : null}
    </Notice>
  );
}

type ResultsProps = {
  lang: string;
  slug: string;
  organizationId: string;
  filters: FindEmployersFilters;
  names: ReferenceNames;
  canManage: boolean;
};

// The results of one address, streamed behind a skeleton by the page; an error here reaches the route's error boundary,
// which toasts and offers a retry (FR-L3 AC11).
export async function FindEmployersResults({ lang, slug, organizationId, filters, names, canManage }: ResultsProps) {
  const context: FindEmployersContext = { lang, slug, names, canManage };
  const search = await searchEmployers(organizationId, filters);
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
        <p className="font-semibold">Occupation and size filters are available on Professional.</p>
        <p className="mt-2">
          <TextLink href={findEmployersPath(lang, slug, findEmployersQuery({ ...filters, occupation: undefined, min_workers: undefined, cursor: undefined }))}>
            Search without them
          </TextLink>
        </p>
      </Notice>
    );
  }
  if (search.state === "refused") return <FindEmployersRefusalNotice reason={search.reason} context={context} />;

  const { results, nextCursor, cursorIgnored } = search;
  const filtered = hasFindEmployersFilters(filters);
  const ignoredCursor = cursorIgnored ? (
    <Notice tone="warning" role="alert">
      {findEmployersCursorError}
    </Notice>
  ) : null;
  if (results.length === 0) {
    return (
      <div className="grid gap-4">
        {ignoredCursor}
        <div role="status">
          <EmptyState
            title={filtered ? "No employers or job orders match your filters" : "No employers or job orders fit your profile yet"}
            description={
              filtered
                ? "Try fewer filters or another destination."
                : "Employers appear here when they publish a company page or a job order for the countries you serve."
            }
          >
            {filtered ? (
              <TextLink standalone href={findEmployersPath(lang, slug)}>
                Clear filters
              </TextLink>
            ) : (
              <TextLink standalone href={`${workforceProfilePath(lang, slug)}#where-you-serve-heading`}>
                Edit Where do you serve
              </TextLink>
            )}
          </EmptyState>
        </div>
      </div>
    );
  }

  const companies = results.flatMap((result) => (result.kind === "company" && result.slug ? [result] : []));
  const connections = await getConnectionStates(companies.map(({ employerId }) => ({ id: employerId, type: "employer" as const })));

  return (
    <div className="grid gap-4">
      {ignoredCursor}
      <p role="status" aria-live="polite" className="text-body text-muted-foreground">
        {resultCountText(results.length, nextCursor !== null)}
      </p>
      <ul aria-label="Employers and job orders" className="animate-stagger divide-y border-y">
        {results.map((result) =>
          result.kind === "company" ? (
            <CompanyCard
              key={result.employerId}
              company={result}
              context={context}
              connection={
                result.slug
                  ? {
                      access: connections.access.get(result.employerId) ?? { kind: "none" },
                      following: connections.followed.has(result.employerId),
                    }
                  : null
              }
            />
          ) : (
            <AnonymousJobOrderCard key={result.jobOrder.id} order={result.jobOrder} context={context} />
          ),
        )}
      </ul>
      <div className="flex flex-wrap items-center gap-x-6">
        {nextCursor ? (
          <TextLink standalone href={findEmployersPath(lang, slug, findEmployersQuery({ ...filters, cursor: nextCursor }))}>
            Show more results
          </TextLink>
        ) : null}
        {filters.cursor && !cursorIgnored ? (
          <TextLink standalone href={findEmployersPath(lang, slug, findEmployersQuery({ ...filters, cursor: undefined }))}>
            Back to the first page
          </TextLink>
        ) : null}
      </div>
    </div>
  );
}

// The searches the company saved (FR-L3 AC9), each with the way back to its results and Delete.
export async function SavedSearches({ lang, slug, organizationId, names }: Omit<ResultsProps, "filters" | "canManage">) {
  const saved = await listSavedSearches(organizationId);
  return (
    <section aria-labelledby="saved-searches-heading" className="grid gap-3">
      <h2 id="saved-searches-heading" className="text-h2">
        Saved searches
      </h2>
      {saved.length === 0 ? (
        <p className="text-body text-muted-foreground">No saved searches yet. Choose filters and press Save search.</p>
      ) : (
        <ul className="grid gap-2">
          {saved.map((search) => {
            const label = savedSearchText(search, names);
            const query = findEmployersQuery({
              destination: search.destination ?? undefined,
              industry: search.industry ?? undefined,
              occupation: search.occupation ?? undefined,
              min_workers: search.minWorkers ?? undefined,
              limit: FIND_EMPLOYERS_DEFAULT_LIMIT,
            });
            return (
              <li key={search.id} className="flex flex-wrap items-center justify-between gap-3">
                <TextLink href={findEmployersPath(lang, slug, query)}>{label}</TextLink>
                <DeleteSavedSearchButton slug={slug} id={search.id} label={label} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
