import { EmployerDashboard } from "@/components/dashboard/employer-dashboard";
import { EmptyState } from "@/components/feedback/empty-state";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { GuidedSteps } from "@/components/organization/guided-steps";
import { hasVerifiedTotpFactor } from "@/lib/dal/mfa";
import { getMyOrganizations } from "@/lib/dal/organizations";
import { requireOrgRole } from "@/lib/dal/session";
import { employerDashboardPath, mfaPath } from "@/lib/routes";

// The dashboard of an employer shows one organization: the one named by ?org=<slug>, which must be one the user belongs to
// (anything else is a page that does not exist), or the first of the user. An owner or an admin sees the figures at aal2
// only (FR-A4), so at aal1 the page keeps to the guided steps and says what unlocks the rest. Called as a function by the
// page, not rendered as an element, because it is async.
export async function employerEntry(lang: string, user: { id: string; aal: string }, orgSlug: string | undefined) {
  const [organizations, twoStepDone] = await Promise.all([
    getMyOrganizations(user.id),
    hasVerifiedTotpFactor(lang),
  ]);
  const slug = orgSlug ?? organizations[0]?.slug;
  if (!slug) {
    return (
      <AuthCard title="Dashboard">
        <EmptyState title="Your company is not set up yet" description="Add your company to get started.">
          <TextLink standalone href={`/${lang}/onboarding`}>
            Set up your company
          </TextLink>
        </EmptyState>
      </AuthCard>
    );
  }
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true });
  const others = organizations.filter((other) => other.slug !== organization.slug);
  const needsCode = organization.role !== "member" && user.aal !== "aal2";
  return (
    <>
      {needsCode ? (
        <AuthCard title="Dashboard" description={organization.displayName}>
          <EmptyState title="Nothing here yet" description="Follow these steps to get started.">
            <GuidedSteps lang={lang} organizationSlug={organization.slug} twoStepDone={twoStepDone} />
          </EmptyState>
          <Notice tone="info">
            {twoStepDone ? (
              <>
                Enter your two-step code to see the figures of your hiring.{" "}
                <TextLink href={mfaPath(lang, employerDashboardPath(lang, organization.slug))}>Enter your code</TextLink>
              </>
            ) : (
              "Owners and admins see the figures of their hiring once two-step verification is set up."
            )}
          </Notice>
        </AuthCard>
      ) : organization.suspended ? (
        <AuthCard title="Dashboard" description={organization.displayName}>
          <Notice tone="error" role="alert">
            This organization is suspended, so its figures are not available.
          </Notice>
        </AuthCard>
      ) : (
        <EmployerDashboard lang={lang} organization={organization} twoStepDone={twoStepDone} />
      )}
      {others.length > 0 ? (
        <nav aria-label="Your organizations" className="mx-auto grid w-full max-w-5xl gap-1">
          <p className="text-sm text-muted-foreground">You also belong to</p>
          {others.map((other) => (
            <TextLink key={other.id} href={employerDashboardPath(lang, other.slug)}>
              {other.displayName}
            </TextLink>
          ))}
        </nav>
      ) : null}
    </>
  );
}
