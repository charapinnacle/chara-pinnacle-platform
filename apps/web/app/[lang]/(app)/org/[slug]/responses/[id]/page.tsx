import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { LinkButton } from "@/components/layout/link-button";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { RequirementHistory } from "@/components/requirements/requirement-history";
import { ResponseDocumentList } from "@/components/responses/response-document-list";
import { ResponseStatusBadge } from "@/components/responses/response-status";
import { ResponseVersions } from "@/components/responses/response-versions";
import { ResponseView } from "@/components/responses/response-view";
import { WithdrawResponse } from "@/components/responses/withdraw-response";
import { ItemModerationNotice } from "@/components/organization/item-moderation-notice";
import { organizationCrumb } from "@/lib/app/navigation";
import { listMyAppeals } from "@/lib/dal/appeals";
import { getItemModeration } from "@/lib/dal/item-moderation";
import { getCountries, getIndustries } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { getResponse, listResponseChanges, listResponseDocuments, listResponseVersions } from "@/lib/dal/responses";
import { requireOrgRole } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { employerLabel } from "@/lib/job-orders/presentation";
import { isLive, partnerNextSteps, submissionsOpen } from "@/lib/responses/presentation";
import { requirementStatusLabels } from "@/lib/requirements/presentation";
import {
  invitationPath,
  jobOrderPath,
  newSubmissionPath,
  requirementSubmissionsPath,
  responseEditPath,
  responsesPath,
} from "@/lib/routes";
import { requirementIdSchema } from "@/lib/validation/requirement";

// The tab names no requirement or employer (NFR-S11).
export const metadata: Metadata = { title: "Response", robots: { index: false } };

// One response of the partner in read view (FR-O2 AC1, AC8, AC10; FR-N2 AC8, AC10; NFR-U4), for every member while
// release 2b is on: the status with the next step, the proposal with the statement that the platform is not a party,
// the documents, the history of versions and the employer's changes to the requirement since the response; Change and
// Withdraw while the employer has not decided; the employer's decision with its note and whether the company may submit
// candidates (FR-O3 step Inform, AC5, AC7, AC8). The requirement is named as the partner knows it (NFR-S11): a shortlist or
// selection names the employer. Another company's response and an unknown id end in the same 404. A response hidden by
// moderation shows the badge, the statement of reasons and the appeal (FR-S1 AC12).
export default async function ResponsePage({ params }: PageProps<"/[lang]/org/[slug]/responses/[id]">) {
  const { lang, slug, id } = await params;
  if (!(await isReleased("release_job_orders"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true, partner: true });
  if (organization.suspended) return <SuspendedOrganization title="Response" subject="responses" />;
  const parsedId = requirementIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const response = await getResponse(organization.id, parsedId.data);
  if (!response) notFound();
  const [versions, documents, changes, countries, industries, submissions, moderation] = await Promise.all([
    listResponseVersions(organization.id, response.id).catch(() => null),
    listResponseDocuments({ responseId: response.id }).catch(() => null),
    listResponseChanges(organization.id, response.id).catch(() => null),
    getCountries(),
    getIndustries(),
    isReleased("release_candidate_submissions"),
    getItemModeration(organization.id, "partner_response", response.id),
  ]);
  const appeal = moderation?.decision ? await listMyAppeals(moderation.decision.id).catch(() => null) : null;
  const names = {
    countries: new Map(countries.map(({ code, name }) => [code, name])),
    industries: new Map(industries.map(({ code, name }) => [code, name])),
  };
  const changeable = isLive(response.status) && response.requirementStatus !== "closed" && response.requirementStatus !== "filled";
  const requirementHref = response.invitationId ? invitationPath(lang, slug, response.invitationId) : jobOrderPath(lang, slug, response.requirementId);

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title={response.title}
        breadcrumb={
          <Breadcrumbs items={[organizationCrumb(lang, organization), { label: "Responses", href: responsesPath(lang, slug) }, { label: response.title }]} />
        }
      >
        <p className="text-body text-muted-foreground">
          {employerLabel(response.employerName)} · Sent <time dateTime={response.createdAt}>{formatDate(response.createdAt)}</time>
        </p>
      </PageHeader>

      <ItemModerationNotice lang={lang} kind="response" effect="The employer no longer sees it and cannot decide on it" moderation={moderation} appeal={appeal} />

      <section aria-labelledby="response-status-heading" className="grid gap-3">
        <h2 id="response-status-heading" className="text-h2">
          Status
        </h2>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ResponseStatusBadge status={response.status} view="partner" />
          <span className="text-small text-muted-foreground">Version {response.version}</span>
        </p>
        <p className="max-w-[65ch] text-body leading-relaxed">{partnerNextSteps[response.status]}</p>
        {response.status === "withdrawn" && response.withdrawnAt ? (
          <p className="text-body text-muted-foreground">
            Withdrawn <time dateTime={response.withdrawnAt}>{formatDate(response.withdrawnAt)}</time>
            {response.withdrawalReason ? `. Your reason: ${response.withdrawalReason}` : null}
          </p>
        ) : null}
        {response.decidedAt ? (
          <Notice tone="info" role="status">
            <p>
              Decided <time dateTime={response.decidedAt}>{formatDate(response.decidedAt)}</time>.
              {submissionsOpen(response.status, response.submissionsAllowed)
                ? " The employer allows your company to submit candidates for this requirement."
                : null}
            </p>
            {response.decisionNote ? <p className="break-words whitespace-pre-line">Note from the employer: {response.decisionNote}</p> : null}
          </Notice>
        ) : null}
        {submissions && submissionsOpen(response.status, response.submissionsAllowed) ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {response.requirementStatus === "open" ? (
              <LinkButton href={newSubmissionPath(lang, slug, response.requirementId)} size="default">
                Submit a candidate
              </LinkButton>
            ) : null}
            <TextLink standalone href={requirementSubmissionsPath(lang, slug, response.requirementId)}>
              See your candidates
            </TextLink>
          </div>
        ) : null}
        {isLive(response.status) && response.requirementStatus !== "open" ? (
          <Notice tone="info" role="status">
            The requirement is {requirementStatusLabels[response.requirementStatus].toLowerCase()} at the moment.
            {changeable ? " You can still change or withdraw your response." : " You can still withdraw your response."}
          </Notice>
        ) : null}
        {isLive(response.status) ? (
          <div className="flex flex-wrap gap-3">
            {changeable ? (
              <LinkButton href={responseEditPath(lang, slug, response.id)} size="default">
                Change response
              </LinkButton>
            ) : null}
            <WithdrawResponse slug={slug} responseId={response.id} />
          </div>
        ) : null}
      </section>

      <ResponseView response={response} view="partner" />

      <section aria-labelledby="response-documents-heading" className="grid gap-3">
        <h2 id="response-documents-heading" className="text-h2">
          Supporting documents
        </h2>
        {documents === null ? (
          <Notice tone="warning" role="status">
            The documents could not be loaded. Reload the page to try again.
          </Notice>
        ) : (
          <ResponseDocumentList slug={slug} documents={documents} />
        )}
      </section>

      <ResponseVersions versions={versions} />

      {isLive(response.status) || response.status === "shortlisted" || response.status === "selected" ? (
        <RequirementHistory
          id="changes"
          title="Changes to the requirement since you responded"
          intro="The employer's saved changes to the requirement since your response, with the values before and after."
          empty="The employer has not changed the requirement since you responded."
          versions={changes}
          names={names}
        />
      ) : null}

      <p>
        <TextLink standalone href={requirementHref}>
          {response.invitationId ? "See the invitation" : "See the job order"}
        </TextLink>
      </p>
    </div>
  );
}
