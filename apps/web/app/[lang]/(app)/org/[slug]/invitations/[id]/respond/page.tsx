import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { EligibilityError } from "@/components/responses/eligibility-error";
import { RespondSection } from "@/components/responses/respond-section";
import { organizationCrumb } from "@/lib/app/navigation";
import { getInvitation } from "@/lib/dal/invitations";
import { isReleased } from "@/lib/dal/release";
import { getResponseEligibility } from "@/lib/dal/responses";
import { requireOrgRole } from "@/lib/dal/session";
import { invitationPath, invitationRespondPath, invitationsPath } from "@/lib/routes";
import { requirementIdSchema } from "@/lib/validation/requirement";

export const metadata: Metadata = { title: "Respond to an invitation", robots: { index: false } };

// The response form for the requirement of an invitation (FR-O1 AC8: Accept opens it; FR-O2), for every member of the
// invited company while release 2b is on, even for a private requirement. An invitation of another company, an unknown
// id and a closed invitation end in the same 404.
export default async function RespondToInvitationPage({ params }: PageProps<"/[lang]/org/[slug]/invitations/[id]/respond">) {
  const { lang, slug, id } = await params;
  if (!(await isReleased("release_job_orders"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true, partner: true });
  if (organization.suspended) return <SuspendedOrganization title="Respond to an invitation" subject="invitations" />;
  const parsedId = requirementIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const invitation = await getInvitation(organization.id, parsedId.data);
  if (!invitation?.requirement) notFound();
  const { requirement } = invitation;
  const eligibility = await getResponseEligibility(organization.id, requirement.id).catch(() => "failed" as const);
  if (eligibility === null) notFound();

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Respond to this invitation"
        description={`${invitation.title} · ${invitation.employerName}`}
        breadcrumb={
          <Breadcrumbs
            items={[
              organizationCrumb(lang, organization),
              { label: "Invitations", href: invitationsPath(lang, slug) },
              { label: invitation.title, href: invitationPath(lang, slug, invitation.id) },
              { label: "Respond" },
            ]}
          />
        }
      />
      {eligibility === "failed" ? (
        <EligibilityError />
      ) : (
        <RespondSection
          lang={lang}
          slug={slug}
          organization={organization}
          requirement={{ id: requirement.id, workersNeeded: requirement.workersNeeded, countryCode: requirement.countryCode }}
          eligibility={eligibility}
          selfHref={invitationRespondPath(lang, slug, invitation.id)}
        />
      )}
    </div>
  );
}
