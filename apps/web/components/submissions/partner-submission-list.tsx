import { UserRoundPlus } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { SubmissionStatusBadge } from "@/components/submissions/submission-status";
import { listPartnerSubmissions } from "@/lib/dal/submissions";
import { formatDate } from "@/lib/i18n/format";
import { partnerNextSteps, partnerSubmissionLabels, submissionCountText } from "@/lib/submissions/presentation";
import { partnerSubmissionsPath, requirementSubmissionsPath, responsesPath } from "@/lib/routes";

type PartnerSubmissionListProps = {
  lang: string;
  slug: string;
  organizationId: string;
  // One requirement's candidates, or every requirement's with the requirement named on each row.
  requirementId: string | null;
  cursor: string | null;
};

// One page of the candidates the partner asked to submit, newest first (FR-O4 AC12, NFR-U4): the address entered until
// the candidate approves and the candidate's name after it, the status in words with what it means, and the dates, with
// each stage the employer moved the candidate to and when (FR-O5 AC10), never the employer's notes or reasons.
export async function PartnerSubmissionList({ lang, slug, organizationId, requirementId, cursor }: PartnerSubmissionListProps) {
  const { submissions, nextCursor, cursorIgnored } = await listPartnerSubmissions(organizationId, requirementId, cursor);
  const pagePath = (next?: string) =>
    requirementId ? requirementSubmissionsPath(lang, slug, requirementId, next) : partnerSubmissionsPath(lang, slug, next);
  if (submissions.length === 0) {
    return (
      <div role="status">
        <EmptyState
          icon={UserRoundPlus}
          title="No candidates submitted yet"
          description="Once the employer selects your company, or allows it to submit candidates, you can ask candidates for their permission to be submitted."
        >
          {requirementId ? null : (
            <TextLink standalone href={responsesPath(lang, slug)}>
              See your responses
            </TextLink>
          )}
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      {cursorIgnored ? (
        <Notice tone="info" role="status">
          That page no longer exists, so the newest candidates are shown.
        </Notice>
      ) : null}
      <p role="status" aria-live="polite" className="text-body text-muted-foreground">
        {submissionCountText(submissions.length, nextCursor !== null)}
      </p>
      <ul className="divide-y border-y" aria-label="Candidates">
        {submissions.map((submission) => (
          <li key={submission.id} className="grid gap-2 py-5">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <h2 className="text-h3 min-w-0 break-words">{submission.candidateName ?? submission.invitedEmail ?? "Candidate"}</h2>
              <SubmissionStatusBadge status={submission.status} view="partner" />
            </div>
            {requirementId ? null : (
              <p className="text-body break-words">
                <TextLink href={requirementSubmissionsPath(lang, slug, submission.requirementId)}>{submission.title}</TextLink>
              </p>
            )}
            <p className="max-w-[65ch] text-body leading-relaxed">{partnerNextSteps[submission.status]}</p>
            {submission.note ? <p className="text-small break-words whitespace-pre-line text-muted-foreground">Your note: {submission.note}</p> : null}
            <p className="text-small text-muted-foreground">
              Request sent <time dateTime={submission.createdAt}>{formatDate(submission.createdAt)}</time>
              {submission.approvedAt ? (
                <>
                  {" "}
                  · Approved <time dateTime={submission.approvedAt}>{formatDate(submission.approvedAt)}</time>
                </>
              ) : submission.decidedAt ? (
                <>
                  {" "}
                  · {submission.status === "expired" ? "Expired" : "Answered"} <time dateTime={submission.decidedAt}>{formatDate(submission.decidedAt)}</time>
                </>
              ) : null}
              {submission.withdrawnAt ? (
                <>
                  {" "}
                  · Withdrawn <time dateTime={submission.withdrawnAt}>{formatDate(submission.withdrawnAt)}</time>
                </>
              ) : null}
              {submission.stageChangedAt ? (
                <>
                  {" "}
                  · Last change <time dateTime={submission.stageChangedAt}>{formatDate(submission.stageChangedAt)}</time>
                </>
              ) : null}
            </p>
            {submission.stages.length > 1 ? (
              <ol aria-label={`Stages of ${submission.candidateName ?? "the candidate"}`} className="flex flex-wrap gap-x-4 gap-y-1 text-small">
                {submission.stages.map((stage) => (
                  <li key={`${stage.status}-${stage.at}`}>
                    {partnerSubmissionLabels[stage.status]} <time dateTime={stage.at}>{formatDate(stage.at)}</time>
                  </li>
                ))}
              </ol>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {nextCursor ? (
          <TextLink standalone href={pagePath(nextCursor)}>
            Show more candidates
          </TextLink>
        ) : null}
        {cursor ? (
          <TextLink standalone href={pagePath()}>
            Back to the first page
          </TextLink>
        ) : null}
      </div>
    </div>
  );
}
