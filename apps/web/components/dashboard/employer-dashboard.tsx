import { Suspense } from "react";
import { Panel } from "@/components/dashboard/panel";
import { PlanAlerts } from "@/components/dashboard/plan-alerts";
import { PlanCard } from "@/components/dashboard/plan-card";
import { StageTable } from "@/components/dashboard/stage-table";
import { SummaryCard } from "@/components/dashboard/summary-card";
import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { PageHeader } from "@/components/layout/page-header";
import { GuidedSteps } from "@/components/organization/guided-steps";
import { startDashboardLoad } from "@/lib/dal/dashboard";
import { applicantsPath, billingPath, jobsPath, notificationSettingsPath } from "@/lib/routes";
import type { MemberRole } from "@/lib/validation/team";

type EmployerDashboardProps = {
  lang: string;
  organization: { id: string; slug: string; displayName: string; role: MemberRole };
  twoStepDone: boolean;
};

type FirstStepsProps = { empty: Promise<boolean>; lang: string; slug: string; role: MemberRole; twoStepDone: boolean };

async function FirstSteps({ empty, lang, slug, role, twoStepDone }: FirstStepsProps) {
  if (!(await empty)) return null;
  if (role === "member") {
    return (
      <EmptyState title="No vacancies yet" description="An owner or admin creates the vacancies of your company." />
    );
  }
  return (
    <EmptyState title="Nothing here yet" description="Follow these steps to get started.">
      <GuidedSteps lang={lang} organizationSlug={slug} twoStepDone={twoStepDone} />
      <TextLink standalone href={`${jobsPath(lang, slug)}/new`}>
        Create your first vacancy
      </TextLink>
    </EmptyState>
  );
}

// The summary of the hiring of one organisation for a member, or for an owner or admin at aal2. The reads start together;
// each part shows its own when it is ready, or its own error.
export function EmployerDashboard({ lang, organization, twoStepDone }: EmployerDashboardProps) {
  const { slug, role } = organization;
  const { applications, vacancies, plan, empty } = startDashboardLoad(organization.id);
  const billingHref = role === "member" ? null : billingPath(lang, slug);
  const now = new Date();

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-page">
      <PageHeader title="Dashboard" description={organization.displayName} />

      <Panel promise={plan} errorTitle="The plan could not be loaded" quiet>
        {(value) => <PlanAlerts plan={value} now={now} slug={slug} billingHref={billingHref} />}
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Panel promise={vacancies} errorTitle="The open vacancies could not be counted">
          {({ open }) => <SummaryCard label="Open vacancies" value={open} href={jobsPath(lang, slug, { status: "open" })} />}
        </Panel>
        <Panel promise={applications} errorTitle="The new applications could not be counted">
          {({ recent }) => (
            <SummaryCard
              label="New applications"
              hint="in the last 7 days"
              value={recent}
              href={applicantsPath(lang, slug, { sort: "applied", dir: "desc" })}
            />
          )}
        </Panel>
        <Panel promise={plan} errorTitle="The plan could not be loaded">
          {(value) => <PlanCard plan={value} now={now} billingHref={billingHref} />}
        </Panel>
      </div>

      <Panel promise={applications} errorTitle="The applicants by stage could not be counted">
        {(value) => <StageTable lang={lang} slug={slug} applications={value} />}
      </Panel>

      <Suspense fallback={null}>
        <FirstSteps empty={empty} lang={lang} slug={slug} role={role} twoStepDone={twoStepDone} />
      </Suspense>

      <TextLink standalone href={notificationSettingsPath(lang, slug)}>
        Notification settings
      </TextLink>
    </div>
  );
}
