import { EmptyState } from "@/components/feedback/empty-state";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { JobOrderRefusalNotice } from "@/components/job-orders/job-order-refusal";
import { listJobOrders, type JobOrderSummary } from "@/lib/dal/job-orders";
import { formatDate } from "@/lib/i18n/format";
import { employerLabel, jobOrderCountText, reasonOf, responsesText } from "@/lib/job-orders/presentation";
import { hasJobOrderFilters, jobOrderQuery, type JobOrderFilters } from "@/lib/job-orders/search-params";
import { workersText } from "@/lib/requirements/presentation";
import { jobOrderPath, jobOrdersPath } from "@/lib/routes";

type Names = { countries: Map<string, string>; industries: Map<string, string> };

type CardProps = { lang: string; slug: string; order: JobOrderSummary; names: Names; canManage: boolean };

// A card holds what list_job_orders returned and nothing else (NFR-S11): an eligible partner reads the employer name or
// "Company not named", the industry, the destinations, the start date and the responses (FR-N1 AC11); a partner that
// sees only the title reads the destination, the size and why, with the link to the part of its profile that fixes it.
function JobOrderCard({ lang, slug, order, names, canManage }: CardProps) {
  const country = names.countries.get(order.countryCode) ?? order.countryCode;
  const destinations = order.countries.length > 0 ? order.countries.map((code) => names.countries.get(code) ?? code).join(", ") : country;
  const responses = responsesText(order.responseCount, order.responsesFewerThan);
  return (
    <li className="grid gap-2 py-6">
      <h2 className="text-h2">
        <TextLink href={jobOrderPath(lang, slug, order.id)} className="break-words">
          {order.title}
        </TextLink>
      </h2>
      {order.eligible ? (
        <>
          <p className="text-body break-words">
            {employerLabel(order.employerName)}
            {order.industryCode ? ` · ${names.industries.get(order.industryCode) ?? order.industryCode}` : ""} · {destinations}
          </p>
          <p className="text-body text-muted-foreground">
            {workersText(order.workersNeeded)}
            {order.startDate ? (
              <>
                {" "}
                · Starts <time dateTime={order.startDate}>{formatDate(order.startDate)}</time>
              </>
            ) : null}
            {responses ? ` · ${responses}` : ""}
          </p>
          {order.publishedOn ? (
            <p className="text-small text-muted-foreground">
              Published <time dateTime={order.publishedOn}>{formatDate(order.publishedOn)}</time>
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="text-body text-muted-foreground">
            {country} · {workersText(order.workersNeeded)}
          </p>
          <ul className="grid gap-1 text-body" aria-label={`Why only the title of ${order.title} is shown`}>
            {order.reasons.map((reason) => {
              const { text, action } = reasonOf(reason, { lang, slug, country, canManage });
              return (
                <li key={reason}>
                  {text}{" "}
                  {action ? <TextLink href={action.href}>{action.label}</TextLink> : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </li>
  );
}

type ResultsProps = {
  lang: string;
  slug: string;
  organizationId: string;
  filters: JobOrderFilters;
  names: Names;
  canManage: boolean;
};

// The job orders of one address, streamed behind a skeleton by the page; an error here reaches the route's error
// boundary, which toasts and offers a retry (FR-N1 AC11).
export async function JobOrderResults({ lang, slug, organizationId, filters, names, canManage }: ResultsProps) {
  const result = await listJobOrders(organizationId, filters);
  if (result.state === "rate_limited") {
    return (
      <Notice tone="warning" role="alert">
        <p className="font-semibold">Too many requests. Please wait a minute and try again.</p>
      </Notice>
    );
  }
  if (result.state === "refused") return <JobOrderRefusalNotice lang={lang} slug={slug} reason={result.reason} />;

  const { orders, nextCursor } = result;
  const filtered = hasJobOrderFilters(filters);
  if (orders.length === 0) {
    return (
      <div role="status">
        <EmptyState
          title={filtered ? "No job orders match your filters" : "There are no open job orders yet"}
          description={filtered ? "Try fewer filters or another destination." : "New job orders appear here as employers publish them."}
        >
          {filtered ? (
            <TextLink standalone href={jobOrdersPath(lang, slug)}>
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
        {jobOrderCountText(orders.length, nextCursor !== null)}
      </p>
      <ul aria-label="Job orders" className="animate-stagger divide-y border-y">
        {orders.map((order) => (
          <JobOrderCard key={order.id} lang={lang} slug={slug} order={order} names={names} canManage={canManage} />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-6">
        {nextCursor ? (
          <TextLink standalone href={jobOrdersPath(lang, slug, jobOrderQuery({ ...filters, cursor: nextCursor }))}>
            Show more job orders
          </TextLink>
        ) : null}
        {filters.cursor ? (
          <TextLink standalone href={jobOrdersPath(lang, slug, jobOrderQuery({ ...filters, cursor: undefined }))}>
            Back to the first page
          </TextLink>
        ) : null}
      </div>
    </div>
  );
}
