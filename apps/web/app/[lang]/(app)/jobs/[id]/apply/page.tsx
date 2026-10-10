import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ApplyForm } from "@/components/applications/apply-form";
import { NotAcceptingNotice } from "@/components/applications/not-accepting-notice";
import { TextLink } from "@/components/forms/text-link";
import { Notice } from "@/components/forms/notice";
import { PageHeader } from "@/components/layout/page-header";
import { profileFields } from "@/lib/applications/presentation";
import { getApplicationStates, getApplyDocuments, getApplyLimits, getApplyOccupation } from "@/lib/dal/applications";
import { getPublicJob } from "@/lib/dal/hiring";
import { requireUser } from "@/lib/dal/session";
import { logVacancy } from "@/lib/jobs/vacancy-log";
import { applicationPath, homePath } from "@/lib/routes";
import { jobIdSchema } from "@/lib/validation/job";

export const metadata: Metadata = { title: "Apply — CHARA", robots: { index: false } };

// For candidates only: a visitor goes to log in and comes back here (requireUser), a company user gets the page of an
// address that does not exist. A candidate who has an application for the vacancy is sent to it instead of to a form;
// a vacancy that is not open and visible, or does not exist, shows one message whatever the reason.
export default async function ApplyPage({ params }: PageProps<"/[lang]/jobs/[id]/apply">) {
  const { lang, id } = await params;
  const user = await requireUser(lang);
  if (user.accountKind === null) redirect(homePath(lang, null));
  if (user.accountKind !== "worker") notFound();

  const jobId = jobIdSchema.safeParse(id);
  if (!jobId.success) return <NotAcceptingNotice lang={lang} />;
  const existing = (await getApplicationStates([jobId.data])).get(jobId.data);
  if (existing && existing.status !== "withdrawn") redirect(`${applicationPath(lang, existing.id)}?existing=1`);

  const [job, occupation, limits, documents] = await Promise.all([
    getPublicJob(jobId.data),
    getApplyOccupation(user.id),
    getApplyLimits(),
    getApplyDocuments(),
  ]);
  if (!occupation) redirect(homePath(lang, null));
  // Name, last name and country cannot be empty in the database; the occupation is the one field a passport may lack.
  const missing = occupation.occupationId === null ? [profileFields.occupation_id] : [];
  if (job && missing.length === 0) {
    logVacancy({ event: "vacancy_action", action: "apply", jobId: job.id, viewer: "candidate" });
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <PageHeader title={job ? `Apply for ${job.title}` : "Apply"} description={job?.employer.displayName} />
      {!job ? (
        <NotAcceptingNotice lang={lang} />
      ) : missing.length > 0 ? (
        <Notice tone="warning" role="alert" className="grid gap-2">
          <p className="font-semibold">Complete your passport before you apply</p>
          <ul className="grid list-disc ps-5">
            {missing.map(({ label, section }) => (
              <li key={section}>
                <TextLink href={`/${lang}/passport#${section}`}>{label}</TextLink>
              </li>
            ))}
          </ul>
        </Notice>
      ) : (
        <ApplyForm
          jobId={job.id}
          lang={lang}
          employerName={job.employer.displayName}
          limits={limits}
          documents={documents}
        />
      )}
    </div>
  );
}
