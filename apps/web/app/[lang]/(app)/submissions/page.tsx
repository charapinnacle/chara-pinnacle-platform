import { UserRoundCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/feedback/empty-state";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { PageHeader } from "@/components/layout/page-header";
import { SubmissionStatusBadge } from "@/components/submissions/submission-status";
import { requireCandidate } from "@/lib/dal/session";
import { listMySubmissionRequests, listMySubmissions } from "@/lib/dal/submissions";
import { isReleased } from "@/lib/dal/release";
import { formatDate } from "@/lib/i18n/format";
import { submissionPath } from "@/lib/routes";
import { WORKERS_NEVER_PAY } from "@/lib/validation/commitment";

export const metadata: Metadata = { title: "Submissions", robots: { index: false } };

// The candidate's submission requests and submissions (FR-O4 steps Invite, Approve, Withdraw; AC5, AC9, AC10; NFR-U4),
// while candidate submissions are released: the requests waiting for an answer first, with the date they expire, then
// the answered ones with their status. Reading the requests links those sent to the candidate's confirmed address before
// the account existed. The page says that workers never pay and where a fee demand is reported (FR-J3 step Show and
// Report, release 2b): from the request of the company that asked.
export default async function SubmissionsPage({ params }: PageProps<"/[lang]/submissions">) {
  const { lang } = await params;
  if (!(await isReleased("release_candidate_submissions"))) notFound();
  await requireCandidate(lang);
  const [requests, submissions] = await Promise.all([listMySubmissionRequests(), listMySubmissions()]);

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Submissions"
        description="Recruitment and staffing companies ask your permission before they submit you to an employer. Nothing is shared until you approve."
      />
      <Notice tone="info">
        <p>
          {WORKERS_NEVER_PAY}. If a company asks you for a fee, open its request and choose Report a fee demand.
        </p>
      </Notice>
      {requests.length === 0 && submissions.length === 0 ? (
        <div role="status">
          <EmptyState
            icon={UserRoundCheck}
            title="No submission requests yet"
            description="When a recruitment or staffing company asks to submit you for a job, the request appears here."
          />
        </div>
      ) : (
        <>
          <section aria-labelledby="requests-heading" className="grid gap-3">
            <h2 id="requests-heading" className="text-h2">
              Waiting for your answer
            </h2>
            {requests.length === 0 ? (
              <p className="text-body text-muted-foreground">No request is waiting for your answer.</p>
            ) : (
              <ul className="grid gap-3">
                {requests.map((request) => (
                  <Card as="li" key={request.id} padding="lg" className="gap-2">
                    <h3 className="text-h3">
                      <TextLink href={submissionPath(lang, request.id)} className="wrap-anywhere">
                        {request.title}
                      </TextLink>
                    </h3>
                    <p className="text-body wrap-anywhere">
                      From {request.partnerName} · {request.employerName ? `${request.employerName}, ` : ""}
                      {request.countryName}
                    </p>
                    <p className="text-small text-muted-foreground">
                      Received <time dateTime={request.createdAt}>{formatDate(request.createdAt)}</time> · Answer by{" "}
                      <time dateTime={request.expiresAt}>{formatDate(request.expiresAt)}</time>
                    </p>
                  </Card>
                ))}
              </ul>
            )}
          </section>
          {submissions.length > 0 ? (
            <section aria-labelledby="answered-heading" className="grid gap-3">
              <h2 id="answered-heading" className="text-h2">
                Answered
              </h2>
              <ul className="grid gap-3">
                {submissions.map((submission) => (
                  <Card as="li" key={submission.id} padding="lg" className="gap-2">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <h3 className="text-h3 min-w-0">
                        <TextLink href={submissionPath(lang, submission.id)} className="wrap-anywhere">
                          {submission.title}
                        </TextLink>
                      </h3>
                      <SubmissionStatusBadge status={submission.status} view="candidate" closed={submission.submissionsClosed} />
                    </div>
                    <p className="text-body wrap-anywhere">
                      From {submission.partnerName} · {submission.employerName ? `${submission.employerName}, ` : ""}
                      {submission.countryName}
                    </p>
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
