import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { FocusOnChange } from "@/components/invitations/focus-on-change";
import { FocusOnHash } from "@/components/invitations/focus-on-hash";
import { InvitationAnswer } from "@/components/invitations/invitation-answer";
import { InvitationStatusBadge } from "@/components/invitations/invitation-status";
import { JobOrderView } from "@/components/job-orders/job-order-view";
import { EligibilityError } from "@/components/responses/eligibility-error";
import { EligibilityPanel } from "@/components/responses/eligibility-panel";
import { limitPromptFor } from "@/components/responses/respond-section";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { RequirementHistory } from "@/components/requirements/requirement-history";
import { organizationCrumb } from "@/lib/app/navigation";
import { getInvitation, listInvitationChanges } from "@/lib/dal/invitations";
import { getCountries, getIndustries } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { getResponseEligibility } from "@/lib/dal/responses";
import { requireOrgRole } from "@/lib/dal/session";
import { formatDate } from "@/lib/i18n/format";
import { canAnswer, partnerNextSteps } from "@/lib/invitations/presentation";
import { requirementStatusLabels } from "@/lib/requirements/presentation";
import { companyPagePath, invitationRespondPath, invitationsPath } from "@/lib/routes";
import { requirementIdSchema } from "@/lib/validation/requirement";

// The title of the tab says only "Invitation": nothing of the requirement or the employer leaves the page in its
// metadata.
export const metadata: Metadata = { title: "Invitation", robots: { index: false } };

// One invitation of a recruitment or staffing company (FR-O1 AC8), for every member while release 2b is on: the
// requirement in full, even private, and the employer's name (the invitation reveals it) while it is pending, accepted
// or responded, with the changes since the invitation (FR-M2 step Edit, V43); only the title and the employer once it is
// declined, withdrawn or expired. The first open marks it seen. Once accepted, the eligibility panel offers Respond (the
// response form, FR-O1 AC8) or names the missing condition; once responded, it links the response (V46).
// An invitation of another company and an unknown id end in the same notFound(), so a competing partner learns nothing.
export default async function InvitationPage({ params }: PageProps<"/[lang]/org/[slug]/invitations/[id]">) {
  const { lang, slug, id } = await params;
  if (!(await isReleased("release_job_orders"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true, partner: true });
  if (organization.suspended) return <SuspendedOrganization title="Invitation" subject="invitations" />;
  const parsedId = requirementIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const invitation = await getInvitation(organization.id, parsedId.data);
  if (!invitation) notFound();
  const { requirement } = invitation;
  const [countries, industries, changes] = requirement
    ? await Promise.all([getCountries(), getIndustries(), listInvitationChanges(organization.id, invitation.id).catch(() => null)])
    : [[], [], []];
  const names = {
    countries: new Map(countries.map(({ code, name }) => [code, name])),
    industries: new Map(industries.map(({ code, name }) => [code, name])),
  };
  const responding = requirement && (invitation.status === "accepted" || invitation.status === "responded");
  const eligibility = responding ? await getResponseEligibility(organization.id, requirement.id).catch(() => "failed" as const) : null;
  const limitPrompt = eligibility && eligibility !== "failed" ? await limitPromptFor(organization, eligibility) : null;

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title={invitation.title}
        breadcrumb={
          <Breadcrumbs
            items={[organizationCrumb(lang, organization), { label: "Invitations", href: invitationsPath(lang, slug) }, { label: invitation.title }]}
          />
        }
      >
        <p className="text-body text-muted-foreground">
          {invitation.employerCompanySlug ? (
            <TextLink href={companyPagePath(lang, invitation.employerCompanySlug)}>{invitation.employerName}</TextLink>
          ) : (
            invitation.employerName
          )}{" "}
          invited your company on <time dateTime={invitation.invitedAt}>{formatDate(invitation.invitedAt)}</time>.
        </p>
      </PageHeader>

      <section aria-labelledby="invitation-status-heading" className="grid gap-3">
        <h2 id="invitation-status-heading" tabIndex={-1} className="text-h2">
          Status
        </h2>
        <FocusOnChange targetId="invitation-status-heading" value={invitation.status} />
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <InvitationStatusBadge status={invitation.status} view="partner" />
          {invitation.answeredAt ? (
            <span className="text-small text-muted-foreground">
              Answered <time dateTime={invitation.answeredAt}>{formatDate(invitation.answeredAt)}</time>
            </span>
          ) : null}
        </p>
        <p className="max-w-[65ch] text-body leading-relaxed">{partnerNextSteps[invitation.status]}</p>
        {invitation.status === "declined" && invitation.declineReason ? (
          <p className="max-w-[65ch] text-body break-words whitespace-pre-line text-muted-foreground">Your reason: {invitation.declineReason}</p>
        ) : null}
        {requirement && invitation.requirementStatus && invitation.requirementStatus !== "open" ? (
          <Notice tone="info" role="status">
            The requirement is {requirementStatusLabels[invitation.requirementStatus].toLowerCase()} at the moment, so partners cannot
            respond to it now.
          </Notice>
        ) : null}
      </section>

      {eligibility === "failed" ? (
        <EligibilityError />
      ) : eligibility && requirement ? (
        <EligibilityPanel
          lang={lang}
          slug={slug}
          organization={{ id: organization.id, type: organization.type, canManage: organization.role !== "member" }}
          eligibility={eligibility}
          countryName={(code) => names.countries.get(code) ?? code}
          destinationName={names.countries.get(requirement.countryCode) ?? requirement.countryCode}
          respondHref={invitationRespondPath(lang, slug, invitation.id)}
          limitPrompt={limitPrompt}
        />
      ) : null}

      {canAnswer(invitation.status) ? <InvitationAnswer slug={slug} invitationId={invitation.id} employerName={invitation.employerName} respondHref={invitationRespondPath(lang, slug, invitation.id)} /> : null}

      {requirement ? <FocusOnHash targetId="changes" /> : null}
      {requirement ? (
        <RequirementHistory
          id="changes"
          title="Changes since you were invited"
          intro="The employer's saved changes to this requirement since your company was invited, with the values before and after."
          empty="The employer has not changed the requirement since your company was invited."
          versions={changes}
          names={names}
        />
      ) : null}

      {requirement ? (
        <section aria-labelledby="invitation-requirement-heading" className="grid gap-4">
          <h2 id="invitation-requirement-heading" className="text-h2">
            The requirement
          </h2>
          <JobOrderView order={requirement} names={names} context={{ lang, slug, canManage: organization.role !== "member" }} />
        </section>
      ) : (
        <Notice tone="info" role="status">
          This invitation is closed, so only its title and the employer are shown.
        </Notice>
      )}

      <p>
        <TextLink standalone href={invitationsPath(lang, slug)}>
          Back to the invitations
        </TextLink>
      </p>
    </div>
  );
}
