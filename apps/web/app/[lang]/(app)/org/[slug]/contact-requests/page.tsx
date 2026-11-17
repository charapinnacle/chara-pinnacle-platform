import { Handshake } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import * as z from "zod";
import { WithdrawContactRequest } from "@/components/contact-requests/withdraw-contact-request";
import { EmptyState } from "@/components/feedback/empty-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { TextLink } from "@/components/forms/text-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Card } from "@/components/layout/card";
import { PageHeader } from "@/components/layout/page-header";
import { MessageButton } from "@/components/messaging/message-button";
import { organizationCrumb } from "@/lib/app/navigation";
import {
  contactRequestStatuses,
  contactRequestTones,
  isContactRequestStatus,
  sentNextSteps,
  sentStatusLabels,
  type ContactRequestStatus,
} from "@/lib/contact-requests/presentation";
import { listSentContactRequests, type SentContactRequest } from "@/lib/dal/contact-requests";
import { getCountries, getOccupations } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { appealPath, conversationPath, findWorkersPath, orgContactRequestsPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

// Nothing about a worker who has not accepted is in the title or the metadata (NFR-S9).
export const metadata: Metadata = { title: "Contact requests", robots: { index: false } };

const cursorSchema = z.object({ at: z.iso.datetime({ offset: true }), id: z.uuid() });

function parseCursor(value: unknown): { at: string; id: string } | null {
  if (typeof value !== "string") return null;
  const [at, id] = value.split("|");
  const parsed = cursorSchema.safeParse({ at, id });
  return parsed.success ? parsed.data : null;
}

function pagePath(lang: string, slug: string, status: ContactRequestStatus | null, before?: string): string {
  const path = orgContactRequestsPath(lang, slug, status ?? undefined);
  if (!before) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ before }).toString()}`;
}

type Names = { occupations: Record<string, string>; countries: Record<string, string> };

// How the organisation names the worker of a request: by first and last name once the worker accepted, by the card
// otherwise (FR-Q3 AC7, NFR-S9).
function workerLabel(request: SentContactRequest, names: Names): string {
  if (request.workerName) return request.workerName;
  if (request.occupationId) return names.occupations[request.occupationId] ?? request.occupationId;
  return "Worker no longer visible";
}

function RequestItem({ request, lang, slug, names, messaging }: {
  request: SentContactRequest;
  lang: string;
  slug: string;
  names: Names;
  messaging: boolean;
}) {
  const label = workerLabel(request, names);
  const country = request.currentCountry ? (names.countries[request.currentCountry] ?? request.currentCountry) : null;
  return (
    <Card as="li" padding="lg" className="gap-2">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h2 className="text-h3 min-w-0 wrap-anywhere">{label}</h2>
        <StatusBadge status={contactRequestTones[request.status]}>{sentStatusLabels[request.status]}</StatusBadge>
      </div>
      <p className="text-body text-muted-foreground">
        {[request.headline, country].filter(Boolean).join(" · ")}
        {request.headline || country ? " · " : ""}Sent <time dateTime={request.createdAt}>{formatDate(request.createdAt)}</time>
        {request.sentByMe ? " by you" : ""}
      </p>
      <p className="text-body leading-relaxed whitespace-pre-line wrap-anywhere">{request.message}</p>
      {request.jobTitle ? <p className="text-body">Vacancy: {request.jobTitle}</p> : null}
      {request.hiddenBy !== null ? (
        <p className="text-small">
          <strong>Hidden by moderation.</strong> The worker no longer sees this request and cannot answer it.{" "}
          <TextLink href={appealPath(lang, request.hiddenBy)}>See the reasons and how to appeal</TextLink>
        </p>
      ) : null}
      <p className="text-small text-muted-foreground">
        {sentNextSteps[request.status]}
        {request.status === "pending" ? (
          <>
            {" "}
            The request closes on <time dateTime={request.expiresAt}>{formatDate(request.expiresAt)}</time>.
          </>
        ) : null}
      </p>
      {request.status === "pending" ? (
        <div>
          <WithdrawContactRequest slug={slug} requestId={request.id} cardLabel={label} />
        </div>
      ) : null}
      {request.status === "accepted" && request.conversationId ? (
        <p>
          <TextLink href={conversationPath(lang, slug, request.conversationId)}>Open the conversation with {label}</TextLink>
        </p>
      ) : request.status === "accepted" && messaging ? (
        <div>
          <MessageButton contextType="contact_request" contextId={request.id} slug={slug} recipient={label} />
        </div>
      ) : null}
    </Card>
  );
}

const filterLabels: Record<ContactRequestStatus, string> = {
  pending: "Waiting",
  accepted: "Accepted",
  declined: "Declined",
  expired: "No answer",
  withdrawn: "Withdrawn",
};

// The contact requests an organisation sent from Find Workers (FR-Q3 AC7, AC8, AC10; SOP steps Send and Reveal; NFR-U4),
// for every member while Find Workers is released; owners and admins at aal2, as for applicant data, since an accepted
// request names the worker. Newest first, 20 a page, with a filter by status in the address.
export default async function OrganizationContactRequestsPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/contact-requests">) {
  const [{ lang, slug }, raw] = await Promise.all([params, searchParams]);
  if (!(await isReleased("release_find_workers"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true, partner: "either" });
  const status = isContactRequestStatus(raw.status) ? raw.status : null;
  const cursor = parseCursor(raw.before);
  const [page, occupations, countries, messaging] = await Promise.all([
    listSentContactRequests(organization.id, { status, cursor }),
    getOccupations(),
    getCountries(),
    isReleased("release_messaging"),
  ]);
  const names: Names = {
    occupations: Object.fromEntries(occupations.map(({ code, label }) => [code, label])),
    countries: Object.fromEntries(countries.map(({ code, name }) => [code, name])),
  };
  const filters: (ContactRequestStatus | null)[] = [null, ...contactRequestStatuses];

  return (
    <div className="grid w-full max-w-4xl gap-section">
      <PageHeader
        title="Contact requests"
        description="Requests your organisation sent to workers in Find Workers. A worker's name is shown only after they accept."
        breadcrumb={<Breadcrumbs items={[organizationCrumb(lang, organization), { label: "Contact requests" }]} />}
      />
      <nav aria-label="Filter by status">
        <ul className="flex flex-wrap gap-2">
          {filters.map((value) => (
            <li key={value ?? "all"}>
              <TextLink
                href={pagePath(lang, slug, value)}
                aria-current={value === status ? "page" : undefined}
                className={cn("inline-flex min-h-11 items-center rounded-lg px-3", value === status && "bg-accent text-accent-foreground")}
              >
                {value ? filterLabels[value] : "All"}
              </TextLink>
            </li>
          ))}
        </ul>
      </nav>
      {page.items.length === 0 ? (
        <div role="status">
          <EmptyState
            icon={Handshake}
            title={status ? "No contact requests with this status" : "No contact requests yet"}
            description="Send a contact request from a worker's card in Find Workers. The worker decides whether to share their name with you."
          >
            <TextLink standalone href={findWorkersPath(lang, slug)}>
              Find workers
            </TextLink>
          </EmptyState>
        </div>
      ) : (
        <ul aria-label="Contact requests" className="grid gap-3">
          {page.items.map((request) => (
            <RequestItem key={request.id} request={request} lang={lang} slug={slug} names={names} messaging={messaging} />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-x-6">
        {page.nextCursor ? (
          <TextLink standalone href={pagePath(lang, slug, status, page.nextCursor)}>
            Show older requests
          </TextLink>
        ) : null}
        {cursor ? (
          <TextLink standalone href={pagePath(lang, slug, status)}>
            Back to the newest
          </TextLink>
        ) : null}
      </div>
    </div>
  );
}
