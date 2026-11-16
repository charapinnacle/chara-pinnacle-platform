import { UserRoundCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { LinkButton } from "@/components/layout/link-button";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { PartnerSubmissionList } from "@/components/submissions/partner-submission-list";
import { SubmissionStatusBadge } from "@/components/submissions/submission-status";
import { organizationCrumb } from "@/lib/app/navigation";
import { getRequirement } from "@/lib/dal/requirements";
import { requireOrgRole } from "@/lib/dal/session";
import { getSubmissionTarget, listRequirementSubmissions, submissionsReleased } from "@/lib/dal/submissions";
import { formatDate } from "@/lib/i18n/format";
import { employerLabel } from "@/lib/job-orders/presentation";
import { newSubmissionPath, partnerSubmissionsPath, requirementPath, requirementsPath, responsePath } from "@/lib/routes";
import { requirementIdSchema } from "@/lib/validation/requirement";

// The tab names no requirement or employer (NFR-S11).
export const metadata: Metadata = { title: "Candidates", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The candidates of one requirement, the page the submission notices link to (FR-O4 AC12, step Deliver; NFR-U4), while
// candidate submissions are released. For the partner (any member): its own requests with their status and, while the
// employer has opened submissions to it, Submit a candidate. For the employer (any member; owners and admins at aal2 as on
// the applicant pages): the candidates who approved, with the partner that proposed them; the stages are the pipeline's
// (FR-O5). A partner without a response to the requirement, another employer's requirement and an unknown id end in the
// same 404.
export default async function RequirementSubmissionsPage({
  params,
  searchParams,
}: PageProps<"/[lang]/org/[slug]/requirements/[id]/submissions">) {
  const [{ lang, slug, id }, raw] = await Promise.all([params, searchParams]);
  if (!(await submissionsReleased())) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true, partner: "either" });
  const parsedId = requirementIdSchema.safeParse(id);
  if (!parsedId.success) notFound();

  if (organization.type === "employer") {
    await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true, partner: "either" });
    if (organization.suspended) return <SuspendedOrganization title="Candidates" subject="workforce requirements" />;
    const requirement = await getRequirement(organization.id, parsedId.data);
    if (!requirement) notFound();
    const submissions = await listRequirementSubmissions(organization.id, requirement.id);
    return (
      <div className="grid w-full max-w-3xl gap-section">
        <PageHeader
          title="Candidates"
          description={`The candidates recruitment and staffing companies submitted for ${requirement.title}, once each candidate approved.`}
          breadcrumb={
            <Breadcrumbs
              items={[
                organizationCrumb(lang, organization),
                { label: "Workforce requirements", href: requirementsPath(lang, slug) },
                { label: requirement.title, href: requirementPath(lang, slug, requirement.id) },
                { label: "Candidates" },
              ]}
            />
          }
        />
        {submissions.length === 0 ? (
          <div role="status">
            <EmptyState
              icon={UserRoundCheck}
              title="No candidates submitted yet"
              description="A selected partner's candidates appear here once they approve their submission."
            />
          </div>
        ) : (
          <ul className="divide-y border-y" aria-label="Candidates">
            {submissions.map((submission) => (
              <li key={submission.id} className="grid gap-2 py-5">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <h2 className="text-h3 min-w-0 break-words">{submission.candidateName ?? "Candidate"}</h2>
                  <SubmissionStatusBadge status={submission.status} view="partner" />
                </div>
                <p className="text-body break-words">Proposed by {submission.partnerName}</p>
                {submission.note && submission.status !== "withdrawn" ? (
                  <p className="text-small break-words whitespace-pre-line text-muted-foreground">Note from the partner: {submission.note}</p>
                ) : null}
                <p className="text-small text-muted-foreground">
                  Submitted <time dateTime={submission.approvedAt}>{formatDate(submission.approvedAt)}</time>
                  {submission.withdrawnAt ? (
                    <>
                      {" "}
                      · Withdrawn by the candidate <time dateTime={submission.withdrawnAt}>{formatDate(submission.withdrawnAt)}</time>
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (organization.suspended) return <SuspendedOrganization title="Candidates" subject="candidate submissions" />;
  const target = await getSubmissionTarget(organization.id, parsedId.data);
  if (!target) notFound();
  const cursor = typeof raw.cursor === "string" && UUID.test(raw.cursor) ? raw.cursor : null;

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Candidates"
        breadcrumb={
          <Breadcrumbs
            items={[
              organizationCrumb(lang, organization),
              { label: "Submissions", href: partnerSubmissionsPath(lang, slug) },
              { label: target.title },
            ]}
          />
        }
      >
        <p className="text-body break-words">
          {target.title} · {employerLabel(target.employerName)}
        </p>
        {target.open ? (
          <div className="flex flex-wrap gap-3">
            <LinkButton href={newSubmissionPath(lang, slug, target.requirementId)} size="default">
              Submit a candidate
            </LinkButton>
          </div>
        ) : (
          <Notice tone="info" role="status">
            Your company cannot submit more candidates for this requirement at the moment.{" "}
            <TextLink href={responsePath(lang, slug, target.responseId)}>See your response</TextLink>
          </Notice>
        )}
      </PageHeader>
      <Suspense key={cursor ?? "first"} fallback={<LoadingSkeleton rows={4} />}>
        <PartnerSubmissionList lang={lang} slug={slug} organizationId={organization.id} requirementId={target.requirementId} cursor={cursor} />
      </Suspense>
    </div>
  );
}
