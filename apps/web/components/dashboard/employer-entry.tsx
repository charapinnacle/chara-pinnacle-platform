import { Building2, LockKeyhole } from "lucide-react";
import { EmployerDashboard } from "@/components/dashboard/employer-dashboard";
import { Panel } from "@/components/dashboard/panel";
import { EmptyState } from "@/components/feedback/empty-state";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { LinkButton } from "@/components/layout/link-button";
import { PageHeader } from "@/components/layout/page-header";
import { GuidedSteps } from "@/components/organization/guided-steps";
import { getFirstSteps } from "@/lib/dal/dashboard";
import { hasVerifiedTotpFactor } from "@/lib/dal/mfa";
import { getMyOrganizations } from "@/lib/dal/organizations";
import { requireOrgRole } from "@/lib/dal/session";
import { employerDashboardPath, mfaPath } from "@/lib/routes";

// The dashboard of an employer shows one organization: the one named by ?org=<slug>, which must be one the user belongs to
// (anything else is a page that does not exist), or the first of the user. An owner or an admin sees the figures at aal2
// only (FR-A4), so at aal1 the page keeps to the first steps and says what unlocks the rest. Called as a function by the
// page, not rendered as an element, because it is async.
export async function employerEntry(lang: string, user: { id: string; aal: string }, orgSlug: string | undefined) {
  const [organizations, twoStepDone] = await Promise.all([getMyOrganizations(user.id), hasVerifiedTotpFactor(lang)]);
  const slug = orgSlug ?? organizations[0]?.slug;
  if (!slug) {
    return (
      <div className="grid gap-section">
        <PageHeader title="Dashboard" description="Your hiring on CHARA starts with your company." />
        <EmptyState icon={Building2} title="Your company is not set up yet" description="Add your company to publish vacancies and invite your team.">
          <LinkButton href={`/${lang}/onboarding`}>Set up your company</LinkButton>
        </EmptyState>
      </div>
    );
  }
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true });
  const header = <PageHeader title="Dashboard" description={organization.displayName} />;
  if (organization.role !== "member" && user.aal !== "aal2") {
    return (
      <div className="grid gap-section">
        {header}
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
        <div className="grid items-start gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <Panel promise={getFirstSteps(organization.id)} errorTitle="The first steps could not be loaded">
              {(steps) => <GuidedSteps lang={lang} organizationSlug={organization.slug} twoStepDone={twoStepDone} steps={steps} />}
            </Panel>
          </div>
          <Card padding="lg" className="gap-3 lg:col-span-5">
            <span aria-hidden className="flex size-9 items-center justify-center rounded-lg bg-accent text-brand-ink">
              <LockKeyhole className="size-4" strokeWidth={1.75} />
            </span>
            <p className="text-body text-muted-foreground">
              Your open vacancies, new applications and applicants by stage appear here after the two-step check, because they
              include data about candidates.
            </p>
          </Card>
        </div>
      </div>
    );
  }
  if (organization.suspended) {
    return (
      <div className="grid gap-section">
        {header}
        <Notice tone="error" role="alert">
          This organization is suspended, so its figures are not available.
        </Notice>
      </div>
    );
  }
  return <EmployerDashboard lang={lang} organization={organization} twoStepDone={twoStepDone} />;
}
