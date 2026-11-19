import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FocusOnChange } from "@/components/invitations/focus-on-change";
import { InvitationUsage } from "@/components/invitations/invitation-usage";
import { RequirementInvitationList } from "@/components/invitations/requirement-invitation-list";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { organizationCrumb } from "@/lib/app/navigation";
import { getInvitationUsage, listRequirementInvitations } from "@/lib/dal/invitations";
import { isReleased } from "@/lib/dal/release";
import { getRequirement } from "@/lib/dal/requirements";
import { requireOrgRole } from "@/lib/dal/session";
import { partnerDirectoryPath } from "@/lib/partners/search-params";
import { canSuggestPartners } from "@/lib/requirements/suggestions";
import { billingPath, requirementPartnersPath, requirementPath, requirementsPath } from "@/lib/routes";
import { requirementIdSchema } from "@/lib/validation/requirement";

export const metadata: Metadata = { title: "Invitations", robots: { index: false } };

const HEADING_ID = "requirement-invitations-heading";

// The partners invited to one requirement and the status of each (FR-O1 step Track, AC9), for every member of the
// employer while release 2b is on; owners and admins withdraw an invitation before a response (AC10) and get the
// upgrade prompt at the plan's limit (AC12). Invitations are sent from the suggestions, the directory and the profiles.
export default async function RequirementInvitationsPage({ params }: PageProps<"/[lang]/org/[slug]/requirements/[id]/invitations">) {
  const { lang, slug, id } = await params;
  if (!(await isReleased("release_job_orders"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true, partner: "either" });
  if (organization.type !== "employer") notFound();
  if (organization.suspended) return <SuspendedOrganization title="Invitations" subject="workforce requirements" />;
  const parsedId = requirementIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const [requirement, directories] = await Promise.all([getRequirement(organization.id, parsedId.data), isReleased("release_partner_directories")]);
  if (!requirement) notFound();
  const [invitations, usage] = await Promise.all([
    listRequirementInvitations(organization.id, requirement.id),
    getInvitationUsage(organization.id, requirement.id),
  ]);
  const manager = organization.role !== "member";
  const kind = requirement.partnerNeed === "staffing" ? "staffing" : "recruitment";

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Invitations"
        titleProps={{ id: HEADING_ID, tabIndex: -1 }}
        breadcrumb={
          <Breadcrumbs
            items={[
              organizationCrumb(lang, organization),
              { label: "Workforce requirements", href: requirementsPath(lang, slug) },
              { label: requirement.title, href: requirementPath(lang, slug, requirement.id) },
              { label: "Invitations" },
            ]}
          />
        }
      >
        <p className="max-w-[65ch] text-body leading-relaxed text-muted-foreground">
          The recruitment and staffing companies invited to {requirement.title}, newest first. Each invited partner sees the
          requirement and your company name, and accepts or declines.
          {requirement.status === "open" ? null : " Partners can be invited while the requirement is open."}
        </p>
      </PageHeader>
      <FocusOnChange targetId={HEADING_ID} value={invitations.map((invitation) => invitation.status).join()} />
      <InvitationUsage organizationId={organization.id} requirementId={requirement.id} usage={usage} billingHref={billingPath(lang, slug)} canUpgrade={manager} />
      <RequirementInvitationList
        lang={lang}
        slug={slug}
        requirementId={requirement.id}
        invitations={invitations}
        canManage={manager}
        findPartnersHref={partnerDirectoryPath(lang, kind)}
        suggestionsHref={
          directories && canSuggestPartners(requirement.status, requirement.partnerNeed) ? requirementPartnersPath(lang, slug, requirement.id) : null
        }
      />
    </div>
  );
}
