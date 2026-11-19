import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { ResponseDocumentList } from "@/components/responses/response-document-list";
import { ResponseStatusBadge } from "@/components/responses/response-status";
import { ResponseVersions } from "@/components/responses/response-versions";
import { ResponseView } from "@/components/responses/response-view";
import { organizationCrumb } from "@/lib/app/navigation";
import { isReleased } from "@/lib/dal/release";
import { getResponse, listResponseDocuments, listResponseVersions } from "@/lib/dal/responses";
import { requireOrgRole } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { employerNextSteps } from "@/lib/responses/presentation";
import { partnerProfileForPath, requirementPath, requirementResponsesPath, requirementsPath } from "@/lib/routes";
import { requirementIdSchema } from "@/lib/validation/requirement";

export const metadata: Metadata = { title: "Response", robots: { index: false } };

// One response to a requirement of the employer (FR-O2 AC6, AC9; FR-N2 AC9), for every member while release 2b is on:
// the partner, the status, the proposal, the documents (each opened through a 60-second link, the opening logged) and the
// versions with what changed. Opening it marks the current version seen, so the badge Updated goes. A response to another
// requirement or of another employer ends in the 404.
export default async function RequirementResponsePage({ params }: PageProps<"/[lang]/org/[slug]/requirements/[id]/responses/[responseId]">) {
  const { lang, slug, id, responseId } = await params;
  if (!(await isReleased("release_job_orders"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true, partner: "either" });
  if (organization.type !== "employer") notFound();
  if (organization.suspended) return <SuspendedOrganization title="Response" subject="workforce requirements" />;
  const parsedRequirement = requirementIdSchema.safeParse(id);
  const parsedResponse = requirementIdSchema.safeParse(responseId);
  if (!parsedRequirement.success || !parsedResponse.success) notFound();
  const response = await getResponse(organization.id, parsedResponse.data);
  if (!response || response.requirementId !== parsedRequirement.data) notFound();
  const [versions, documents] = await Promise.all([
    listResponseVersions(organization.id, response.id).catch(() => null),
    listResponseDocuments({ responseId: response.id }).catch(() => null),
  ]);
  const partnerName = response.partnerName ?? "Partner";

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title={partnerName}
        breadcrumb={
          <Breadcrumbs
            items={[
              organizationCrumb(lang, organization),
              { label: "Workforce requirements", href: requirementsPath(lang, slug) },
              { label: response.title, href: requirementPath(lang, slug, response.requirementId) },
              { label: "Responses", href: requirementResponsesPath(lang, slug, response.requirementId) },
              { label: partnerName },
            ]}
          />
        }
      >
        <p className="text-body text-muted-foreground">
          {response.invitationId ? "Invited partner" : "From the job order marketplace"} · Received{" "}
          <time dateTime={response.createdAt}>{formatDate(response.createdAt)}</time>
        </p>
        {response.partnerSlug ? (
          <p>
            <TextLink href={partnerProfileForPath(lang, response.partnerSlug, slug)}>See the partner profile</TextLink>
          </p>
        ) : null}
      </PageHeader>

      <section aria-labelledby="response-status-heading" className="grid gap-3">
        <h2 id="response-status-heading" className="text-h2">
          Status
        </h2>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ResponseStatusBadge status={response.status} view="employer" />
          <span className="text-small text-muted-foreground">
            Version {response.version}
            {response.version > 1 ? (
              <>
                , changed <time dateTime={response.updatedAt}>{formatDate(response.updatedAt)}</time>
              </>
            ) : null}
          </span>
        </p>
        <p className="max-w-[65ch] text-body leading-relaxed">{employerNextSteps[response.status]}</p>
        {response.status === "withdrawn" ? (
          <Notice tone="info" role="status">
            <p>
              Withdrawn {response.withdrawnAt ? <time dateTime={response.withdrawnAt}>{formatDate(response.withdrawnAt)}</time> : null}
            </p>
            <p className="break-words whitespace-pre-line">
              {response.withdrawalReason ? `Reason: ${response.withdrawalReason}` : "No reason given."}
            </p>
          </Notice>
        ) : null}
      </section>

      <ResponseView response={response} view="employer" />

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
    </div>
  );
}
