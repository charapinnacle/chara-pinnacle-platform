import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { InternalNotes } from "@/components/applicants/internal-notes";
import { ProfileSnapshot } from "@/components/applicants/profile-snapshot";
import { ReadOnlyButton } from "@/components/applicants/read-only-button";
import { ShortlistingUpgrade } from "@/components/applicants/shortlisting-upgrade";
import { SharedDocuments } from "@/components/applicants/shared-documents";
import { StageChange } from "@/components/applicants/stage-change";
import { Card } from "@/components/layout/card";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { ReadOnlyPlanNotice } from "@/components/billing/read-only-plan";
import { Notice } from "@/components/forms/notice";
import { applicationStatusLabels, FORMER_CANDIDATE } from "@/lib/applications/presentation";
import { allowedTargets } from "@/lib/applications/stage-machine";
import {
  getApplicantProfile,
  isProfileChanged,
  listApplicationNotes,
  listSharedDocuments,
} from "@/lib/dal/applicant-review";
import { getApplicant, listApplicantEvents, markApplicationViewed } from "@/lib/dal/applicants";
import { isSubscriptionEnded } from "@/lib/dal/hiring";
import { getCountries, getLanguages } from "@/lib/dal/reference";
import { requireOrgRole, requireUser } from "@/lib/dal/session";
import { formatDateTime, formatShortDate } from "@/lib/i18n/format";
import { applicantPath, billingPath, homePath } from "@/lib/routes";
import { todayUtc } from "@/lib/validation/passport";

export const metadata: Metadata = { title: "Applicant — CHARA", robots: { index: false } };

const blockedText = "Your organization has no active paid plan, so the stage cannot be changed.";

const notesCursorSchema = z.string().regex(/^[0-9]{1,15}$/).transform(Number);

const actorText = { candidate: "Candidate", system: "System" } as const;

// The first open by a member is the system's move from Applied to Viewed, made before the page is read so that it shows the
// stage the candidate sees. An application of another organisation, or one that is not the organisation of the address,
// is not found, and a candidate is sent to their own home (FR-E2). A suspended organisation's applicants are not shown at
// all (FR-D5).
export default async function ApplicantPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/applicants/[applicationId]">) {
  const [{ lang, slug, applicationId }, { notesBefore }] = await Promise.all([params, searchParams]);
  const user = await requireUser(lang);
  if (user.accountKind === "worker") redirect(homePath(lang, user.accountKind));
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true });
  if (organization.suspended) return <SuspendedOrganization />;
  const id = z.uuid().safeParse(applicationId);
  if (!id.success) notFound();
  const before = notesCursorSchema.safeParse(notesBefore);
  const first = await getApplicant(id.data);
  if (!first || first.organizationId !== organization.id) notFound();
  const firstOpen = first.status === "applied";
  if (firstOpen) await markApplicationViewed(id.data);
  const [reread, events, profile, documents, changed, notesPage, countries, languages] = await Promise.all([
    firstOpen ? getApplicant(id.data) : first,
    listApplicantEvents(id.data),
    getApplicantProfile(id.data),
    listSharedDocuments(id.data),
    isProfileChanged(id.data),
    listApplicationNotes(id.data, before.success ? before.data : undefined),
    getCountries(),
    getLanguages(),
  ]);
  if (!profile) notFound();
  const applicant = reread ?? first;
  const ended = applicant.stageChangeBlocked !== null && (await isSubscriptionEnded(organization.id));
  const targets = allowedTargets(applicant.status, "employer", { shortlisting: applicant.shortlistingAvailable });
  const name = applicant.applicantName ?? FORMER_CANDIDATE;
  const upgradeForShortlisting =
    !applicant.stageChangeBlocked &&
    !applicant.shortlistingAvailable &&
    allowedTargets(applicant.status, "employer", { shortlisting: true }).includes("shortlisted");

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-page">
      <PageHeader title={name}>
        <p className="text-body font-medium wrap-anywhere">{applicant.jobTitle}</p>
      </PageHeader>

      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <div className="grid gap-0.5">
          <dt className="text-small text-muted-foreground">Stage</dt>
          <dd className="font-medium">{applicationStatusLabels[applicant.status]}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-small text-muted-foreground">Applied</dt>
          <dd className="font-medium">
            <time dateTime={applicant.appliedAt}>{formatShortDate(applicant.appliedAt)}</time>
          </dd>
        </div>
      </dl>

      {applicant.stageChangeBlocked ? (
        <>
          <ReadOnlyPlanNotice
            ended={ended}
            billingHref={organization.role === "member" ? null : billingPath(lang, slug)}
            otherwise={blockedText}
          />
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
            applicationId={applicant.id}
            applicantName={name}
            targets={targets}
            noteMaxChars={applicant.noteMaxChars}
          />
        </div>
      ) : (
        <Notice tone="info" role="status">
          {applicationStatusLabels[applicant.status]} is a final stage. No further stage can be chosen.
        </Notice>
      )}

      {upgradeForShortlisting ? <ShortlistingUpgrade role={organization.role} billingHref={billingPath(lang, slug)} /> : null}

      <ProfileSnapshot
        snapshot={profile.snapshot}
        coverNote={profile.coverNote}
        submittedAt={applicant.appliedAt}
        changed={changed}
        countries={Object.fromEntries(countries.map(({ code, name }) => [code, name]))}
        languages={Object.fromEntries(languages.map(({ code, name }) => [code, name]))}
      />

      <SharedDocuments
        slug={slug}
        applicationId={applicant.id}
        documents={documents}
        shareEnded={changed === null}
        today={todayUtc()}
      />

      <InternalNotes
        slug={slug}
        applicationId={applicant.id}
        notes={notesPage.notes}
        blocked={applicant.stageChangeBlocked !== null}
        olderHref={notesPage.hasMore ? `${applicantPath(lang, slug, applicant.id)}?notesBefore=${notesPage.notes.at(-1)?.id}` : null}
        newestHref={before.success ? applicantPath(lang, slug, applicant.id) : null}
      />

      <section aria-labelledby="history-heading" className="grid gap-2">
        <h2 id="history-heading" className="text-h2">
          History
        </h2>
        <ol className="grid gap-2">
          {events.map((event) => (
            <Card as="li" padding="sm" key={event.id} className="gap-1">
              <p className="font-medium">
                {event.fromStatus
                  ? `${applicationStatusLabels[event.fromStatus]} to ${applicationStatusLabels[event.toStatus]}`
                  : applicationStatusLabels[event.toStatus]}
              </p>
              <p className="text-small text-muted-foreground wrap-anywhere">
                <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                {" · "}
                {event.actor === "employer" ? (event.actorName ?? "Team member") : actorText[event.actor]}
              </p>
              {event.note ? (
                <div className="grid gap-0.5">
                  <p className="text-small text-muted-foreground">Visible to the candidate</p>
                  <p className="wrap-anywhere whitespace-pre-line">{event.note}</p>
                </div>
              ) : null}
            </Card>
          ))}
        </ol>
      </section>
    </div>
  );
}
