import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { SubmissionStatusBadge } from "@/components/submissions/submission-status";
import type { MySubmission } from "@/lib/dal/submissions";
import { formatShortDate } from "@/lib/i18n/format";
import { submissionPath } from "@/lib/routes";
import { proposedByLabel } from "@/lib/submissions/presentation";

// The submissions the candidate approved, next to the direct applications of the journey tracker (FR-O5 AC9): each named
// "Proposed by <partner> for <requirement>", with its stage; the page of each shows the history and Withdraw.
export function TrackerSubmissions({ lang, submissions }: { lang: string; submissions: MySubmission[] }) {
  return (
    <section aria-labelledby="tracker-submissions-heading" className="grid gap-3">
      <h2 id="tracker-submissions-heading" className="text-h2">
        Proposed by recruitment and staffing companies
      </h2>
      <ul className="grid gap-3">
        {submissions.map((submission) => (
          <Card as="li" key={submission.id} padding="lg" className="gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-8">
            <div className="grid gap-1">
              <h3 className="text-h3">
                <TextLink href={submissionPath(lang, submission.id)} className="wrap-anywhere">
                  {proposedByLabel(submission.partnerName, submission.title)}
                </TextLink>
              </h3>
              <p className="text-muted-foreground wrap-anywhere">
                {submission.employerName ? `${submission.employerName}, ` : ""}
                {submission.countryName}
              </p>
            </div>
            <div className="grid gap-1.5 sm:justify-items-end">
              <p>
                <SubmissionStatusBadge status={submission.status} view="candidate" />
              </p>
              {submission.approvedAt ? (
                <p className="text-small text-muted-foreground">
                  Submitted <time dateTime={submission.approvedAt}>{formatShortDate(submission.approvedAt)}</time>
                </p>
              ) : null}
            </div>
          </Card>
        ))}
      </ul>
    </section>
  );
}
