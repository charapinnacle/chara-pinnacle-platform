import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { InternalNotes } from "@/components/applicants/internal-notes";
import { ProfileSnapshot } from "@/components/applicants/profile-snapshot";
import { SharedDocuments } from "@/components/applicants/shared-documents";
import { StageChange } from "@/components/applicants/stage-change";
import { SuspendedOrganization } from "@/components/applicants/suspended-organization";
import { Notice } from "@/components/forms/notice";
import { applicationStatusLabels, FORMER_CANDIDATE } from "@/lib/applications/presentation";
import { allowedTargets } from "@/lib/applications/stage-machine";
import {
  getApplicantProfile,
  NOTES_LIMIT,
  isProfileChanged,
  listApplicationNotes,
  listSharedDocuments,
} from "@/lib/dal/applicant-review";
import { getApplicant, listApplicantEvents, markApplicationViewed } from "@/lib/dal/applicants";
import { getCountries, getLanguages } from "@/lib/dal/reference";
import { requireOrgRole, requireUser } from "@/lib/dal/session";
import { formatDateTime, formatShortDate } from "@/lib/i18n/format";
import { homePath } from "@/lib/routes";
import { todayUtc } from "@/lib/validation/passport";

export const metadata: Metadata = { title: "Applicant — CHARA", robots: { index: false } };

const blockedText = "Your organization has no active paid plan, so the stage cannot be changed.";

const actorText = { candidate: "Candidate", system: "System" } as const;

// The first open by a member is the system's move from Applied to Viewed, made before the page is read so that it shows the
// stage the candidate sees. An application of another organisation, or one that is not the organisation of the address,
// is not found, and a candidate is sent to their own home (FR-E2). A suspended organisation's applicants are not shown at
// all (FR-D5).
export default async function ApplicantPage({ params }: PageProps<"/[lang]/org/[slug]/applicants/[applicationId]">) {
  const { lang, slug, applicationId } = await params;
  const user = await requireUser(lang);
  if (user.accountKind === "worker") redirect(homePath(lang, user.accountKind));
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true });
  if (organization.suspended) return <SuspendedOrganization />;
  const id = z.uuid().safeParse(applicationId);
  if (!id.success) notFound();
  const first = await getApplicant(id.data);
  if (!first || first.organizationId !== organization.id) notFound();
  const firstOpen = first.status === "applied";
  if (firstOpen) await markApplicationViewed(id.data);
  const [reread, events, profile, documents, changed, notes, countries, languages] = await Promise.all([
    firstOpen ? getApplicant(id.data) : first,
    listApplicantEvents(id.data),
    getApplicantProfile(id.data),
    listSharedDocuments(id.data),
    isProfileChanged(id.data),
    listApplicationNotes(id.data),
    getCountries(),
    getLanguages(),
  ]);
  if (!profile) notFound();
  const applicant = reread ?? first;
  const targets = allowedTargets(applicant.status, "employer", { shortlisting: applicant.shortlistingAvailable });
  const name = applicant.applicantName ?? FORMER_CANDIDATE;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere sm:text-[1.75rem]">{name}</h1>
        <p className="text-body font-medium wrap-anywhere">{applicant.jobTitle}</p>
      </header>

      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <div className="grid gap-0.5">
          <dt className="text-sm text-muted-foreground">Stage</dt>
          <dd className="font-medium">{applicationStatusLabels[applicant.status]}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-sm text-muted-foreground">Applied</dt>
          <dd className="font-medium">
            <time dateTime={applicant.appliedAt}>{formatShortDate(applicant.appliedAt)}</time>
          </dd>
        </div>
      </dl>

      {applicant.stageChangeBlocked ? (
        <Notice tone="info" role="status">
          {blockedText}
        </Notice>
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
        notes={notes}
        blocked={applicant.stageChangeBlocked !== null}
        limit={NOTES_LIMIT}
      />

      <section aria-labelledby="history-heading" className="grid gap-2">
        <h2 id="history-heading" className="text-lg font-semibold">
          History
        </h2>
        <ol className="grid gap-2">
          {events.map((event) => (
            <li key={event.id} className="grid gap-1 rounded-xl border bg-card p-3">
              <p className="font-medium">
                {event.fromStatus
                  ? `${applicationStatusLabels[event.fromStatus]} to ${applicationStatusLabels[event.toStatus]}`
                  : applicationStatusLabels[event.toStatus]}
              </p>
              <p className="text-sm text-muted-foreground wrap-anywhere">
                <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                {" · "}
                {event.actor === "employer" ? (event.actorName ?? "Team member") : actorText[event.actor]}
              </p>
              {event.note ? (
                <div className="grid gap-0.5">
                  <p className="text-sm text-muted-foreground">Visible to the candidate</p>
                  <p className="wrap-anywhere whitespace-pre-line">{event.note}</p>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
