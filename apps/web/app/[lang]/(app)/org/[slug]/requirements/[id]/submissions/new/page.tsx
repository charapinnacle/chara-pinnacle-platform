import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { CommitmentGate } from "@/components/organization/commitment-gate";
import { SubmitCandidateForm } from "@/components/submissions/submit-candidate-form";
import { organizationCrumb } from "@/lib/app/navigation";
import { getCommitmentBlock } from "@/lib/dal/commitment";
import { requireOrgRole } from "@/lib/dal/session";
import { getSubmissionTarget, submissionsReleased } from "@/lib/dal/submissions";
import { getUsagePrompts } from "@/lib/dal/usage";
import { employerLabel } from "@/lib/job-orders/presentation";
import { billingPath, partnerSubmissionsPath, requirementSubmissionsPath, responsePath } from "@/lib/routes";
import { SUBMISSION_LIMIT_KEY, submissionUsageText } from "@/lib/submissions/presentation";
import { requirementIdSchema } from "@/lib/validation/requirement";
import { WORKERS_NEVER_PAY } from "@/lib/validation/commitment";

// The tab names no requirement or employer (NFR-S11).
export const metadata: Metadata = { title: "Submit a candidate", robots: { index: false } };

const BLOCKED_REASON_ID = "submit-blocked-reason";
const LIMIT_REASON_ID = "submit-limit-reason";

// The partner's form to ask a candidate's permission to be submitted for one requirement (FR-O4 step Request, AC12), for
// any member while candidate submissions are released, with the month's use of the plan's submissions while the limit
// applies. Offered while the employer selected the partner, or shortlisted it and opened submissions, on an open
// requirement; otherwise the page says so and links the response. A partner without a response and an unknown id end in
// the same 404. While the employer-pays commitment is not accepted in its current version, the form stays in view with
// Send request disabled, the reason and who acts (FR-J3 AC4, FR-S4 AC7); likewise at the month's limit, where the upgrade
// prompt is the reason (FR-R1), since the database would refuse the request.
export default async function NewSubmissionPage({ params }: PageProps<"/[lang]/org/[slug]/requirements/[id]/submissions/new">) {
  const { lang, slug, id } = await params;
  if (!(await submissionsReleased())) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true, partner: true });
  if (organization.suspended) return <SuspendedOrganization title="Submit a candidate" subject="candidate submissions" />;
  const parsedId = requirementIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const target = await getSubmissionTarget(organization.id, parsedId.data);
  if (!target) notFound();
  const [prompts, commitment] = target.open
    ? await Promise.all([
        getUsagePrompts(organization.id, organization.type, [SUBMISSION_LIMIT_KEY]).catch(() => null),
        getCommitmentBlock(organization.id),
      ])
    : [null, null];
  const usage = prompts?.[SUBMISSION_LIMIT_KEY] ?? null;
  const atLimit = usage !== null && usage.used >= usage.limit;
  const blockedBy = [commitment ? BLOCKED_REASON_ID : null, atLimit ? LIMIT_REASON_ID : null].filter(Boolean).join(" ") || undefined;
  const canManage = organization.role !== "member";
  const billingHref = billingPath(lang, slug);

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Submit a candidate"
        breadcrumb={
          <Breadcrumbs
            items={[
              organizationCrumb(lang, organization),
              { label: "Submissions", href: partnerSubmissionsPath(lang, slug) },
              { label: target.title, href: requirementSubmissionsPath(lang, slug, target.requirementId) },
              { label: "Submit a candidate" },
            ]}
          />
        }
      >
        <p className="text-body break-words">
          {target.title} · {employerLabel(target.employerName)}
        </p>
        <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
          The candidate receives a request by email and in their worker account, or an invitation to create one. Nothing
          reaches the employer until the candidate approves and chooses which documents to share. {WORKERS_NEVER_PAY}.
        </p>
      </PageHeader>

      {target.open ? (
        <>
          {commitment ? (
            <CommitmentGate slug={slug} owner={organization.role === "owner"} commitment={commitment} reasonId={BLOCKED_REASON_ID} />
          ) : null}
          {usage ? (
            atLimit ? (
              <Notice tone="warning" role="status">
                <UpgradePrompt
                  organizationId={organization.id}
                  organizationType={organization.type}
                  prompt={usage}
                  billingHref={billingHref}
                  canUpgrade={canManage}
                  reasonId={LIMIT_REASON_ID}
                />
              </Notice>
            ) : (
              <p className="text-small text-muted-foreground">{submissionUsageText(usage.used, usage.limit)}.</p>
            )
          ) : null}
          <SubmitCandidateForm
            slug={slug}
            requirementId={target.requirementId}
            organization={{ id: organization.id, type: organization.type, canManage }}
            billingHref={billingHref}
            blockedBy={blockedBy}
          />
          <p>
            <TextLink standalone href={requirementSubmissionsPath(lang, slug, target.requirementId)}>
              See the candidates of this requirement
            </TextLink>
          </p>
        </>
      ) : (
        <Notice tone="info" role="status">
          Your company cannot submit candidates for this requirement at the moment: the employer must select your company, or
          allow it to submit candidates, and the requirement must be open.{" "}
          <TextLink href={responsePath(lang, slug, target.responseId)}>See your response</TextLink>
        </Notice>
      )}
    </div>
  );
}
