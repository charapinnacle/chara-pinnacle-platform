import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { PreviewActions } from "@/components/jobs/vacancy-actions";
import { VacancyView } from "@/components/jobs/vacancy-view";
import { getEmployer, getJob } from "@/lib/dal/hiring";
import { requireOrgRole } from "@/lib/dal/session";
import { jobPath } from "@/lib/routes";
import { jobIdSchema } from "@/lib/validation/job";

export const metadata: Metadata = { title: "Preview — CHARA", robots: { index: false, follow: false } };

export default async function JobPreviewPage({ params }: PageProps<"/[lang]/org/[slug]/jobs/[id]/preview">) {
  const { lang, slug, id } = await params;
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true });
  if (organization.suspended) return <SuspendedOrganization title="Preview" subject="vacancies" />;
  const parsedId = jobIdSchema.safeParse(id);
  const [job, employer] = await Promise.all([
    parsedId.success ? getJob(organization.id, parsedId.data) : null,
    getEmployer(organization.id),
  ]);
  if (!job) notFound();

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <Notice tone="info" role="status">
        Preview - not public
      </Notice>
      <VacancyView job={job} employer={employer} actions={<PreviewActions />} />
      <TextLink standalone href={jobPath(lang, slug, job.id)}>
        Back to the vacancy
      </TextLink>
    </div>
  );
}
