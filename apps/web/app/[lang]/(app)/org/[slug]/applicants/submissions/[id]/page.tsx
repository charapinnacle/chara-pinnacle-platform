import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import * as z from "zod";
import { InternalNotes } from "@/components/applicants/internal-notes";
import { ProfileSnapshot } from "@/components/applicants/profile-snapshot";
import { ReadOnlyButton } from "@/components/applicants/read-only-button";
import { SharedDocuments } from "@/components/applicants/shared-documents";
import { ShortlistingUpgrade } from "@/components/applicants/shortlisting-upgrade";
import { StageChange } from "@/components/applicants/stage-change";
import { ReadOnlyPlanNotice } from "@/components/billing/read-only-plan";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Card } from "@/components/layout/card";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { organizationCrumb } from "@/lib/app/navigation";
import { getApplicantAccess } from "@/lib/dal/applicant-list";
import { isSubscriptionEnded } from "@/lib/dal/hiring";
import { getCountries, getLanguages } from "@/lib/dal/reference";
import { requireOrgRole, requireUser } from "@/lib/dal/session";
import {
  getEmployerSubmission,
  listSubmissionDocuments,
  listSubmissionEvents,
  listSubmissionNotes,
  markSubmissionViewed,
} from "@/lib/dal/submission-pipeline";
import { submissionsReleased } from "@/lib/dal/submissions";
import { formatDateTime, formatShortDate } from "@/lib/i18n/format";
import { billingPath, employerSubmissionPath, homePath, requirementPath, requirementsPath, submissionPipelinePath } from "@/lib/routes";
import { employerSubmissionLabels, submittedByLabel } from "@/lib/submissions/presentation";
import { submissionTargets } from "@/lib/submissions/stage-machine";
import { todayUtc } from "@/lib/validation/passport";
import { SUBMISSION_REASON_MIN_CHARS } from "@/lib/validation/submission-pipeline";

export const metadata: Metadata = { title: "Submitted candidate", robots: { index: false } };

const blockedText = "Your organization has no active paid plan, so the stage cannot be changed.";

const notesCursorSchema = z.string().regex(/^[0-9]{1,15}$/).transform(Number);

const actorText = { candidate: "Candidate", employer: "Your organization", system: "System" } as const;

// A candidate a partner submitted, as the employer reviews it (FR-O5 steps Review, Move; AC5 to AC7), while candidate
// submissions are released: the partner that proposed the candidate, the stage with the moves of an application, the
// profile as the candidate approved it, the shared documents (logged, time-limited links for submission_review), the
// internal notes nobody outside the organisation reads, and the history. The first open is the system's move to Viewed.
// Another organisation's submission, a request not approved and an unknown id are the same 404.
export default async function EmployerSubmissionPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/applicants/submissions/[id]">) {
  const [{ lang, slug, id }, { notesBefore }] = await Promise.all([params, searchParams]);
  if (!(await submissionsReleased())) notFound();
  const user = await requireUser(lang);
  if (user.accountKind === "worker") redirect(homePath(lang, user.accountKind));
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true });
  if (organization.suspended) return <SuspendedOrganization />;
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) notFound();
  const before = notesCursorSchema.safeParse(notesBefore);
  const first = await getEmployerSubmission(parsedId.data);
  if (!first || first.organizationId !== organization.id) notFound();
  const firstOpen = first.status === "submitted";
  if (firstOpen) await markSubmissionViewed(first.id);
  const [reread, access, events, documents, notesPage, countries, languages] = await Promise.all([
    firstOpen ? getEmployerSubmission(first.id) : first,
    getApplicantAccess(organization.id),
    listSubmissionEvents(first.id),
    listSubmissionDocuments(first.id),
    listSubmissionNotes(first.id, before.success ? before.data : undefined),
    getCountries(),
    getLanguages(),
  ]);
  if (!access) notFound();
  const submission = reread ?? first;
  const frozen = access.stageChangeBlocked !== null;
  const ended = frozen && (await isSubscriptionEnded(organization.id));
  const targets = submissionTargets(submission.status, { shortlisting: access.shortlistingAvailable });
  const name = submission.candidateName ?? "Candidate";
  const upgradeForShortlisting =
    !frozen && !access.shortlistingAvailable && submissionTargets(submission.status, { shortlisting: true }).includes("shortlisted");
  const pipelineHref = submissionPipelinePath(lang, slug, { requirement: submission.requirementId });

  return (
    <div className="grid w-full max-w-3xl gap-page">
      <PageHeader
        title={name}
        breadcrumb={
          <Breadcrumbs
            items={[
              organizationCrumb(lang, organization),
              { label: "Workforce requirements", href: requirementsPath(lang, slug) },
              { label: submission.requirementTitle, href: requirementPath(lang, slug, submission.requirementId) },
              { label: "Applicants", href: pipelineHref },
              { label: name },
            ]}
          />
        }
      >
        <p className="text-body font-medium wrap-anywhere">{submittedByLabel(submission.partnerName)}</p>
        <p className="text-body wrap-anywhere">{submission.requirementTitle}</p>
      </PageHeader>

      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <div className="grid gap-0.5">
          <dt className="text-small text-muted-foreground">Stage</dt>
          <dd className="font-medium">{employerSubmissionLabels[submission.status]}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-small text-muted-foreground">Submitted</dt>
          <dd className="font-medium">
            <time dateTime={submission.approvedAt}>{formatShortDate(submission.approvedAt)}</time>
          </dd>
        </div>
      </dl>

      {submission.status === "withdrawn" ? (
        <Notice tone="info" role="status">
          The candidate withdrew this submission. Their profile and documents are no longer shared with your organization.
        </Notice>
      ) : frozen ? (
        <>
          <ReadOnlyPlanNotice ended={ended} billingHref={organization.role === "member" ? null : billingPath(lang, slug)} otherwise={blockedText} />
          {targets.length > 0 ? (
            <div>
              <ReadOnlyButton className="w-full sm:w-auto">Change stage</ReadOnlyButton>
            </div>
          ) : null}
        </>
      ) : targets.length > 0 ? (
        <div>
          <StageChange
            slug={slug}
            subject={{ kind: "submission", id: submission.id }}
            applicantName={name}
            targets={targets}
            noteMaxChars={access.noteMaxChars}
            reasonMinChars={SUBMISSION_REASON_MIN_CHARS}
          />
        </div>
      ) : (
        <Notice tone="info" role="status">
          {employerSubmissionLabels[submission.status]} is a final stage. No further stage can be chosen.
        </Notice>
      )}

      {upgradeForShortlisting ? <ShortlistingUpgrade role={organization.role} billingHref={billingPath(lang, slug)} /> : null}

      {submission.note ? (
        <section aria-labelledby="partner-note-heading" className="grid gap-2">
          <h2 id="partner-note-heading" className="text-h2">
            Note from {submission.partnerName}
          </h2>
          <p className="leading-7 wrap-anywhere whitespace-pre-line">{submission.note}</p>
        </section>
      ) : null}

      {submission.snapshot ? (
        <ProfileSnapshot
          snapshot={submission.snapshot}
          coverNote={null}
          submittedAt={submission.approvedAt}
          changed={false}
          countries={Object.fromEntries(countries.map(({ code, name: countryName }) => [code, countryName]))}
          languages={Object.fromEntries(languages.map(({ code, name: languageName }) => [code, languageName]))}
        />
      ) : null}

      <SharedDocuments
        slug={slug}
        subject={{ kind: "submission", id: submission.id }}
        documents={documents}
        shareEnded={!submission.shareActive}
        today={todayUtc()}
      />

      <InternalNotes
        slug={slug}
        subject={{ kind: "submission", id: submission.id }}
        notes={notesPage.notes}
        blocked={frozen}
        olderHref={notesPage.hasMore ? `${employerSubmissionPath(lang, slug, submission.id)}?notesBefore=${notesPage.notes.at(-1)?.id}` : null}
        newestHref={before.success ? employerSubmissionPath(lang, slug, submission.id) : null}
      />

      <section aria-labelledby="history-heading" className="grid gap-2">
        <h2 id="history-heading" className="text-h2">
          History
        </h2>
        <ol className="grid gap-2">
          {events.map((event) => (
            <Card as="li" padding="sm" key={`${event.createdAt}-${event.toStatus}`} className="gap-1">
              <p className="font-medium">
                {event.fromStatus
                  ? `${employerSubmissionLabels[event.fromStatus]} to ${employerSubmissionLabels[event.toStatus]}`
                  : employerSubmissionLabels[event.toStatus]}
              </p>
              <p className="text-small text-muted-foreground">
                <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                {" · "}
                {actorText[event.actorRole]}
              </p>
              {event.note ? (
                <div className="grid gap-0.5">
                  <p className="text-small text-muted-foreground">Visible to the candidate, not to the partner</p>
                  <p className="wrap-anywhere whitespace-pre-line">{event.note}</p>
                </div>
              ) : null}
            </Card>
          ))}
        </ol>
      </section>

      <TextLink standalone href={pipelineHref}>
        Back to the submitted candidates
      </TextLink>
    </div>
  );
}
