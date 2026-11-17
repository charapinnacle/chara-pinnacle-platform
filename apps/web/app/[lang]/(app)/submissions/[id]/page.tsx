import type { Metadata } from "next";
import { notFound } from "next/navigation";
import * as z from "zod";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { DetailList } from "@/components/layout/detail-list";
import { PageHeader } from "@/components/layout/page-header";
import { MessageButton } from "@/components/messaging/message-button";
import { ApproveRequestForm } from "@/components/submissions/approve-request-form";
import { DeclineRequest } from "@/components/submissions/decline-request";
import { SubmissionStatusBadge } from "@/components/submissions/submission-status";
import { WithdrawSubmission } from "@/components/submissions/withdraw-submission";
import { WorkersNeverPay } from "@/components/submissions/workers-never-pay";
import { getApplyDocuments, getApplyLimits } from "@/lib/dal/applications";
import { isReleased } from "@/lib/dal/release";
import { requireCandidate } from "@/lib/dal/session";
import { listSubmissionEvents } from "@/lib/dal/submission-pipeline";
import { getMySubmission, type SubmissionRequest } from "@/lib/dal/submissions";
import { formatCount, formatDate, formatShortDate } from "@/lib/i18n/format";
import { submissionsPath } from "@/lib/routes";
import {
  candidateNextSteps,
  candidateSubmissionLabels,
  isWithdrawable,
  submissionActorLabels,
} from "@/lib/submissions/presentation";

// The tab names no partner, employer or requirement.
export const metadata: Metadata = { title: "Submission request", robots: { index: false } };

function RequestSummary({ request }: { request: SubmissionRequest }) {
  return (
    <DetailList
      items={[
        { label: "Proposed by", value: request.partnerName },
        { label: "Employer", value: request.employerName ?? "Not named by the employer" },
        { label: "Destination", value: request.cityRegion ? `${request.cityRegion}, ${request.countryName}` : request.countryName },
        { label: "Start date", value: request.startDate ? formatDate(request.startDate) : "Not set" },
        { label: "Workers needed", value: formatCount(request.workersNeeded) },
        { label: "Answer by", value: formatDate(request.expiresAt) },
      ]}
    />
  );
}

// One request or submission of the candidate (FR-O4 steps Approve, Decline, Withdraw, Protect; AC5, AC7, AC8, AC9, AC11;
// NFR-U4), the page the request email and notice link to. A pending request shows the partner, the requirement as the
// candidate may read it (NFR-S11), the partner's note and what will be shared, then Approve with the choice of documents
// and the consent, or Decline; when another company already submitted the candidate for the same requirement only
// Decline is offered. An approved submission shows its stage history with the employer's notes and the reason of a
// decline (FR-O5 AC3, AC9; never an internal note) and can be withdrawn at any stage. Another person's id and an unknown
// one end in the same 404, as does the page while candidate submissions are not released.
export default async function SubmissionPage({ params }: PageProps<"/[lang]/submissions/[id]">) {
  const { lang, id } = await params;
  if (!(await isReleased("release_candidate_submissions"))) notFound();
  await requireCandidate(lang);
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) notFound();
  const found = await getMySubmission(parsedId.data);
  if (!found) notFound();

  if (found.kind === "answered") {
    const { submission } = found;
    const [history, messaging] = await Promise.all([
      submission.approvedAt ? listSubmissionEvents(submission.id) : [],
      isReleased("release_messaging"),
    ]);
    return (
      <div className="grid w-full max-w-3xl gap-section">
        <PageHeader
          title={submission.title}
          actions={
            messaging && submission.approvedAt && submission.status !== "withdrawn" ? (
              <MessageButton
                contextType="candidate_submission"
                contextId={submission.id}
                slug={null}
                recipient={submission.employerName ?? "the employer"}
              />
            ) : undefined
          }
        >
          <p className="text-body wrap-anywhere">
            Proposed by {submission.partnerName} · {submission.employerName ? `${submission.employerName}, ` : ""}
            {submission.countryName}
          </p>
          <TextLink standalone href={submissionsPath(lang)}>
            All submissions
          </TextLink>
        </PageHeader>
        <section aria-labelledby="status-heading" className="grid gap-3">
          <h2 id="status-heading" className="text-h2">
            Status
          </h2>
          <p>
            <SubmissionStatusBadge status={submission.status} view="candidate" />
          </p>
          <p className="max-w-[65ch] text-body leading-relaxed">
            {submission.status === "awaiting_candidate" ? null : candidateNextSteps[submission.status]}
          </p>
          <p className="text-small text-muted-foreground">
            Received <time dateTime={submission.createdAt}>{formatDate(submission.createdAt)}</time>
            {submission.approvedAt ? (
              <>
                {" "}
                · Approved <time dateTime={submission.approvedAt}>{formatDate(submission.approvedAt)}</time>
              </>
            ) : null}
            {submission.withdrawnAt ? (
              <>
                {" "}
                · Withdrawn <time dateTime={submission.withdrawnAt}>{formatDate(submission.withdrawnAt)}</time>
              </>
            ) : null}
          </p>
          {isWithdrawable(submission.status, submission.approvedAt) ? (
            <WithdrawSubmission submissionId={submission.id} title={submission.title} />
          ) : null}
        </section>
        {history.length > 0 ? (
          <section aria-labelledby="timeline-heading" className="grid gap-2">
            <h2 id="timeline-heading" className="text-h2">
              Timeline
            </h2>
            <ol className="grid gap-2">
              {history.map((event) => (
                <Card as="li" padding="sm" key={`${event.createdAt}-${event.toStatus}`} className="block">
                  <p className="font-medium">
                    {candidateSubmissionLabels[event.toStatus]}{" "}
                    <time dateTime={event.createdAt} className="font-normal text-muted-foreground">
                      {formatShortDate(event.createdAt)}
                    </time>
                  </p>
                  <p className="text-small text-muted-foreground">{submissionActorLabels[event.actorRole]}</p>
                  {event.note ? (
                    <div className="mt-1 grid gap-0.5">
                      <p className="text-small text-muted-foreground">
                        {event.toStatus === "rejected" ? "Reason from the employer" : "Note from the employer"}
                      </p>
                      <p className="wrap-anywhere whitespace-pre-line">{event.note}</p>
                    </div>
                  ) : null}
                </Card>
              ))}
            </ol>
          </section>
        ) : null}
        <WorkersNeverPay lang={lang} partnerName={submission.partnerName} submissionId={submission.id} />
      </div>
    );
  }

  const { request } = found;
  const [documents, limits] = await Promise.all([getApplyDocuments(), getApplyLimits()]);

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader title={request.title}>
        <p className="text-body wrap-anywhere">{request.partnerName} would like to submit you as a candidate for this job.</p>
        <TextLink standalone href={submissionsPath(lang)}>
          All submissions
        </TextLink>
      </PageHeader>

      <section aria-labelledby="request-heading" className="grid gap-3">
        <h2 id="request-heading" className="text-h2">
          The request
        </h2>
        <p>
          <SubmissionStatusBadge status="awaiting_candidate" view="candidate" />
        </p>
        <RequestSummary request={request} />
        {request.note ? (
          <div className="grid gap-1">
            <h3 className="text-h3">Note from {request.partnerName}</h3>
            <p className="leading-7 wrap-anywhere whitespace-pre-line">{request.note}</p>
          </div>
        ) : null}
      </section>

      <WorkersNeverPay lang={lang} partnerName={request.partnerName} submissionId={request.id} />

      <section aria-labelledby="answer-heading" className="grid gap-4">
        <h2 id="answer-heading" className="text-h2">
          Your answer
        </h2>
        {request.submittedByPartner ? (
          <Notice tone="info" role="status">
            You have already been proposed for this requirement by {request.submittedByPartner}, so you can only decline this
            request.
          </Notice>
        ) : (
          <>
            <p className="max-w-[65ch] text-body leading-relaxed">
              Approve to let {request.partnerName} submit you: the employer then reads your profile and the documents you
              choose. You can withdraw at any time, which ends the employer&apos;s access.
            </p>
            <ApproveRequestForm
              lang={lang}
              submissionId={request.id}
              recipient={request.employerName ?? "the employer"}
              documents={documents}
              documentsMax={limits.documentsMax}
            />
          </>
        )}
        <DeclineRequest submissionId={request.id} partnerName={request.partnerName} title={request.title} />
      </section>
    </div>
  );
}
