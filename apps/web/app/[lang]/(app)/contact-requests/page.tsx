import { Handshake } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AnswerContactRequest } from "@/components/contact-requests/answer-contact-request";
import { EmptyState } from "@/components/feedback/empty-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { PageHeader } from "@/components/layout/page-header";
import { MessageButton } from "@/components/messaging/message-button";
import {
  contactRequestTones,
  organizationTypeLabels,
  receivedNextSteps,
  receivedStatusLabels,
} from "@/lib/contact-requests/presentation";
import { listReceivedContactRequests, type ReceivedContactRequest } from "@/lib/dal/contact-requests";
import { getCountries } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { requireCandidate } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { conversationPath, findWorkersCardPath, reportPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Contact requests", robots: { index: false } };

function RequestDetails({ request, lang, countries }: { request: ReceivedContactRequest; lang: string; countries: Record<string, string> }) {
  const country = request.organizationCountry ? (countries[request.organizationCountry] ?? request.organizationCountry) : null;
  return (
    <>
      <p className="text-body text-muted-foreground">
        {organizationTypeLabels[request.organizationType]}
        {country ? ` · ${country}` : ""} · Received <time dateTime={request.createdAt}>{formatDate(request.createdAt)}</time>
      </p>
      <p className="text-body leading-relaxed whitespace-pre-line wrap-anywhere">{request.message}</p>
      {request.jobId && request.jobTitle ? (
        <p className="text-body">
          Invites you to apply to <TextLink href={`/${lang}/jobs/${request.jobId}`}>{request.jobTitle}</TextLink>
        </p>
      ) : null}
      <p className="text-small">
        <TextLink href={reportPath(lang, "contact_request", request.id)}>
          Report this request<span className="sr-only"> from {request.organizationName}</span>
        </TextLink>
      </p>
    </>
  );
}

// The contact requests companies sent the worker from Find Workers (FR-Q3 AC10, AC11; SOP steps Notify, Decide, Reveal;
// NFR-U4), while Find Workers is released: the requests waiting for an answer first, with the date they close, then the
// answered ones with their status and next step. Accepting shares the first and last name with that company only. Each
// request can be reported (FR-Q3 AC11, FR-S1); one hidden by moderation leaves the list.
export default async function ContactRequestsPage({ params }: PageProps<"/[lang]/contact-requests">) {
  const { lang } = await params;
  if (!(await isReleased("release_find_workers"))) notFound();
  await requireCandidate(lang);
  const [requests, countryList, messaging] = await Promise.all([
    listReceivedContactRequests(),
    getCountries(),
    isReleased("release_messaging"),
  ]);
  const countries = Object.fromEntries(countryList.map(({ code, name }) => [code, name]));
  const waiting = requests.filter(({ status }) => status === "pending");
  const answered = requests.filter(({ status }) => status !== "pending");

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Contact requests"
        description="Companies that found your card in Find Workers ask to contact you. They do not see your name or contact details unless you accept."
      />
      {requests.length === 0 ? (
        <div role="status">
          <EmptyState
            icon={Handshake}
            title="No contact requests"
            description="When a company that found your card in Find Workers asks to contact you, the request appears here."
          >
            <TextLink standalone href={findWorkersCardPath(lang)}>
              See your Find Workers card
            </TextLink>
          </EmptyState>
        </div>
      ) : (
        <>
          <section aria-labelledby="waiting-heading" className="grid gap-3">
            <h2 id="waiting-heading" className="text-h2">
              Waiting for your answer
            </h2>
            {waiting.length === 0 ? (
              <p className="text-body text-muted-foreground">No request is waiting for your answer.</p>
            ) : (
              <ul className="grid gap-3">
                {waiting.map((request) => (
                  <Card as="li" key={request.id} padding="lg" className="gap-2">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <h3 className="text-h3 min-w-0 wrap-anywhere">{request.organizationName}</h3>
                      <StatusBadge status={contactRequestTones.pending}>{receivedStatusLabels.pending}</StatusBadge>
                    </div>
                    <RequestDetails request={request} lang={lang} countries={countries} />
                    <p className="text-small text-muted-foreground">
                      Accepting shares your first and last name with {request.organizationName} only and opens a conversation.
                      Your documents stay private until you apply or share them. Answer by{" "}
                      <time dateTime={request.expiresAt}>{formatDate(request.expiresAt)}</time>.
                    </p>
                    <AnswerContactRequest requestId={request.id} organizationName={request.organizationName} />
                  </Card>
                ))}
              </ul>
            )}
          </section>
          {answered.length > 0 ? (
            <section aria-labelledby="answered-heading" className="grid gap-3">
              <h2 id="answered-heading" className="text-h2">
                Earlier requests
              </h2>
              <ul className="grid gap-3">
                {answered.map((request) => (
                  <Card as="li" key={request.id} padding="lg" className="gap-2">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <h3 className="text-h3 min-w-0 wrap-anywhere">{request.organizationName}</h3>
                      <StatusBadge status={contactRequestTones[request.status]}>{receivedStatusLabels[request.status]}</StatusBadge>
                    </div>
                    <RequestDetails request={request} lang={lang} countries={countries} />
                    <p className="text-small text-muted-foreground">{receivedNextSteps[request.status]}</p>
                    {request.conversationId ? (
                      <p>
                        <TextLink href={conversationPath(lang, null, request.conversationId)}>
                          Open the conversation with {request.organizationName}
                        </TextLink>
                      </p>
                    ) : request.status === "accepted" && messaging ? (
                      <div>
                        <MessageButton contextType="contact_request" contextId={request.id} slug={null} recipient={request.organizationName} />
                      </div>
                    ) : null}
                  </Card>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
