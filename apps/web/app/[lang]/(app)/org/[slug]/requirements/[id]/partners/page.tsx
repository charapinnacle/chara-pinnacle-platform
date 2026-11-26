import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { PartnerSuggestions } from "@/components/requirements/partner-suggestions";
import { organizationCrumb } from "@/lib/app/navigation";
import { getSuggestionInvitations } from "@/lib/dal/invitations";
import { isReleased } from "@/lib/dal/release";
import { getRequirement, suggestPartners } from "@/lib/dal/requirements";
import { requireOrgRole } from "@/lib/dal/session";
import { RANKING_PATH } from "@/lib/public/navigation";
import { canSuggestPartners, destinationsText, suggestionPlanDisclosure } from "@/lib/requirements/suggestions";
import { billingPath, requirementPath, requirementsPath } from "@/lib/routes";
import { requirementIdSchema } from "@/lib/validation/requirement";

export const metadata: Metadata = { title: "Find partners for this requirement", robots: { index: false } };

// The partners suggested for one requirement (FR-M3, SOP P2-17), for the members of the employer while releases 2a and 2b
// are on: rule-based, with the reasons on every card and the order published on the ranking page [d1.1, NFR-C8]. Nothing
// here tells a partner that it was suggested. An owner or admin of an open requirement selects partners and invites
// them (step Act, AC7; FR-O1 AC12); every member sees which partners already have an invitation.
export default async function RequirementPartnersPage({ params }: PageProps<"/[lang]/org/[slug]/requirements/[id]/partners">) {
  const { lang, slug, id } = await params;
  const [jobOrders, directories] = await Promise.all([isReleased("release_job_orders"), isReleased("release_partner_directories")]);
  if (!jobOrders || !directories) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true, partner: "either" });
  if (organization.type !== "employer") notFound();
  if (organization.suspended) return <SuspendedOrganization title="Find partners for this requirement" subject="workforce requirements" />;
  const parsedId = requirementIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const requirement = await getRequirement(organization.id, parsedId.data);
  if (!requirement) notFound();
  const result = canSuggestPartners(requirement.status, requirement.partnerNeed)
    ? await suggestPartners(organization.id, requirement.id)
    : ({ state: "unavailable" } as const);
  const countries = destinationsText([{ code: requirement.countryCode, name: requirement.country }, ...requirement.destinations]);
  const published = result.state === "found" && requirement.status !== "draft";
  // A failed read of the invitations leaves the suggestions without the invite controls rather than failing the page.
  const invitationState = published ? await getSuggestionInvitations(organization.id, requirement.id) : null;
  const invite =
    invitationState && requirement.status === "open" && organization.role !== "member"
      ? { slug, billingHref: billingPath(lang, slug), usage: invitationState.usage }
      : null;

  return (
    <div className="grid w-full gap-section">
      <PageHeader
        title="Find partners for this requirement"
        breadcrumb={
          <Breadcrumbs
            items={[
              organizationCrumb(lang, organization),
              { label: "Workforce requirements", href: requirementsPath(lang, slug) },
              { label: requirement.title, href: requirementPath(lang, slug, requirement.id) },
              { label: "Find partners" },
            ]}
          />
        }
      >
        <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
          Listed partners that serve {countries} and list at least one occupation of this requirement. They are ordered by
          the number of criteria they meet, then by how recently they updated their profile. {suggestionPlanDisclosure}{" "}
          Partners are not told that they were suggested.{" "}
          <TextLink href={`/${lang}/${RANKING_PATH}`}>How suggestions are ordered</TextLink>
        </p>
      </PageHeader>
      {result.state === "unavailable" ? (
        <Notice tone="info" role="status">
          Partners are suggested for requirements that need partners and are not closed or filled.{" "}
          <TextLink href={requirementPath(lang, slug, requirement.id)}>Back to the requirement</TextLink>
        </Notice>
      ) : result.state === "rate_limited" ? (
        <Notice tone="warning" role="alert">
          <p className="font-semibold">Too many searches. Please wait a minute and try again.</p>
        </Notice>
      ) : (
        <>
          {requirement.status === "draft" ? (
            <Notice tone="info" role="status">
              This requirement is a draft. These suggestions are a preview; publish the requirement to work with partners.
            </Notice>
          ) : null}
          <PartnerSuggestions
            lang={lang}
            organizationId={organization.id}
            requirement={requirement}
            suggestions={result.suggestions}
            more={result.more}
            invitations={invitationState?.invitations ?? {}}
            invite={invite}
          />
        </>
      )}
    </div>
  );
}
