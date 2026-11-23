import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/feedback/empty-state";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { ResponseComparison } from "@/components/responses/response-comparison";
import { organizationCrumb } from "@/lib/app/navigation";
import { getCountries, getLanguages } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { getRequirement } from "@/lib/dal/requirements";
import { compareResponses, getResponseTerms, listResponseDocuments } from "@/lib/dal/responses";
import { requireOrgRole } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { NOT_A_PARTY_EMPLOYER } from "@/lib/responses/presentation";
import {
  requirementInvitationsPath,
  requirementPartnersPath,
  requirementPath,
  requirementResponsePath,
  requirementResponsesPath,
  requirementsPath,
} from "@/lib/routes";
import { requirementIdSchema } from "@/lib/validation/requirement";

export const metadata: Metadata = { title: "Compare responses", robots: { index: false } };

// The responses to one requirement side by side (FR-O3 steps Compare and Decide, AC1, AC2, AC10, AC11), for every member
// of the employer while release 2b is on: one column per response that is not withdrawn, the withdrawn ones listed below.
// Owners and admins (at aal2, as on every organisation page) shortlist, select or decline while the requirement is open
// or paused; members compare only. The agreement and any payment stay outside the platform (decision 3.4).
export default async function ResponseComparisonPage({ params }: PageProps<"/[lang]/org/[slug]/requirements/[id]/responses/compare">) {
  const { lang, slug, id } = await params;
  if (!(await isReleased("release_job_orders"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true, partner: "either" });
  if (organization.type !== "employer") notFound();
  if (organization.suspended) return <SuspendedOrganization title="Compare responses" subject="workforce requirements" />;
  const parsedId = requirementIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const requirement = await getRequirement(organization.id, parsedId.data);
  if (!requirement) notFound();
  const [responses, countries, languages] = await Promise.all([
    compareResponses(organization.id, requirement.id),
    getCountries(),
    getLanguages(),
  ]);
  const live = responses.filter((response) => response.status !== "withdrawn");
  const withdrawn = responses.filter((response) => response.status === "withdrawn");
  const documents =
    live.length > 0 ? await listResponseDocuments({ responseIds: live.map((response) => response.id) }).catch(() => null) : [];
  const terms = await getResponseTerms(live.map((response) => response.id));
  const decidable = requirement.status === "open" || requirement.status === "paused";
  const canDecide = organization.role !== "member" && decidable;

  return (
    <div className="grid w-full gap-section">
      <PageHeader
        title="Compare responses"
        breadcrumb={
          <Breadcrumbs
            items={[
              organizationCrumb(lang, organization),
              { label: "Workforce requirements", href: requirementsPath(lang, slug) },
              { label: requirement.title, href: requirementPath(lang, slug, requirement.id) },
              { label: "Responses", href: requirementResponsesPath(lang, slug, requirement.id) },
              { label: "Compare" },
            ]}
          />
        }
      >
        <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
          Every response to {requirement.title} on the same rows. Shortlisting or selecting a partner shows it your company&apos;s
          name; a selected partner can submit candidates.
        </p>
      </PageHeader>

      {live.length === 0 ? (
        <EmptyState icon={Inbox} title="No responses yet" description="Invite partners, or wait for partners that see this requirement on the job order marketplace.">
          <span className="flex flex-wrap justify-center gap-x-6">
            <TextLink standalone href={requirementPartnersPath(lang, slug, requirement.id)}>
              Invite partners
            </TextLink>
            <TextLink standalone href={requirementInvitationsPath(lang, slug, requirement.id)}>
              See invitations
            </TextLink>
            <TextLink standalone href={requirementPath(lang, slug, requirement.id)}>
              See the job order status
            </TextLink>
          </span>
        </EmptyState>
      ) : (
        <>
          {!decidable ? (
            <Notice tone="info" role="status">
              This requirement is {requirement.status === "draft" ? "a draft" : requirement.status}, so its responses can no longer be
              decided.
            </Notice>
          ) : organization.role === "member" ? (
            <Notice tone="info" role="note">
              The owner and admins of your company shortlist, select and decline responses.
            </Notice>
          ) : null}
          <ResponseComparison
            lang={lang}
            slug={slug}
            requirementId={requirement.id}
            responses={live}
            documents={documents}
            countryNames={new Map(countries.map(({ code, name }) => [code, name]))}
            canDecide={canDecide}
            terms={terms}
            languageNames={new Map(languages.map(({ code, name }) => [code, name]))}
          />
          <Notice tone="info" role="note">
            {NOT_A_PARTY_EMPLOYER}.
          </Notice>
        </>
      )}

      {withdrawn.length > 0 ? (
        <section aria-labelledby="withdrawn-responses-heading" className="grid gap-3">
          <h2 id="withdrawn-responses-heading" className="text-h2">
            Withdrawn
          </h2>
          <ul className="grid gap-2">
            {withdrawn.map((response) => (
              <li key={response.id} className="text-body">
                <TextLink href={requirementResponsePath(lang, slug, requirement.id, response.id)}>{response.partnerName}</TextLink>
                {" · "}Withdrawn
                {response.withdrawnAt ? (
                  <>
                    {" "}
                    <time dateTime={response.withdrawnAt}>{formatDate(response.withdrawnAt)}</time>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
