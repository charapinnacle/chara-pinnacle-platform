import { Bell, BriefcaseBusiness, Inbox, Plus, Users, UsersRound } from "lucide-react";
import { Suspense } from "react";
import { Panel } from "@/components/dashboard/panel";
import { PlanAlerts } from "@/components/dashboard/plan-alerts";
import { PlanCard } from "@/components/dashboard/plan-card";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { StageTable } from "@/components/dashboard/stage-table";
import { SummaryCard } from "@/components/dashboard/summary-card";
import { EmptyState } from "@/components/feedback/empty-state";
import { LinkButton } from "@/components/layout/link-button";
import { PageHeader } from "@/components/layout/page-header";
import { GuidedSteps } from "@/components/organization/guided-steps";
import { getFirstSteps, startDashboardLoad } from "@/lib/dal/dashboard";
import { applicantsPath, billingPath, jobsPath, membersPath, notificationSettingsPath } from "@/lib/routes";
import type { MemberRole } from "@/lib/validation/team";

type EmployerDashboardProps = {
  lang: string;
  organization: { id: string; slug: string; displayName: string; role: MemberRole };
  twoStepDone: boolean;
};

async function NoVacanciesYet({ empty, lang, slug, role }: { empty: Promise<boolean>; lang: string; slug: string; role: MemberRole }) {
  if (!(await empty)) return null;
  if (role === "member") {
    return <EmptyState icon={BriefcaseBusiness} title="No vacancies yet" description="An owner or admin creates the vacancies of your company." />;
  }
  return (
    <EmptyState icon={BriefcaseBusiness} title="Nothing here yet" description="Publish a vacancy and its applications will be counted here.">
      <LinkButton href={`${jobsPath(lang, slug)}/new`}>Create your first vacancy</LinkButton>
    </EmptyState>
  );
}

// The summary of the hiring of one organisation for a member, or for an owner or admin at aal2. The reads start together;
// each part shows its own when it is ready, or its own error. An owner or admin also sees the first steps until they are
// all done, then the quick actions; a member sees the quick actions.
export function EmployerDashboard({ lang, organization, twoStepDone }: EmployerDashboardProps) {
  const { slug, role } = organization;
  const { applications, vacancies, plan, empty } = startDashboardLoad(organization.id);
  const manager = role !== "member";
  const firstSteps = manager ? getFirstSteps(organization.id) : null;
  const billingHref = manager ? billingPath(lang, slug) : null;
  const now = new Date();
  const quickActions = (
    <QuickActions
      actions={[
        { href: applicantsPath(lang, slug), label: "Review applicants", icon: Inbox },
        ...(manager ? [{ href: membersPath(lang, slug), label: "Manage your team", icon: UsersRound }] : []),
        { href: notificationSettingsPath(lang, slug), label: "Notification settings", icon: Bell },
      ]}
    />
  );

  return (
    <div className="grid gap-section">
      <PageHeader
        title="Dashboard"
        description={organization.displayName}
        actions={
          manager ? (
            <LinkButton href={`${jobsPath(lang, slug)}/new`} size="default" className="gap-2">
              <Plus aria-hidden className="size-4" />
              New vacancy
            </LinkButton>
          ) : null
        }
      />

      <Panel promise={plan} errorTitle="The plan could not be loaded" quiet>
        {(value) => <PlanAlerts plan={value} now={now} slug={slug} billingHref={billingHref} />}
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Panel promise={vacancies} errorTitle="The open vacancies could not be counted">
          {({ open }) => (
            <SummaryCard label="Open vacancies" detail="Accepting applications now" value={open} href={jobsPath(lang, slug, { status: "open" })} icon={BriefcaseBusiness} />
          )}
        </Panel>
        <Panel promise={applications} errorTitle="The new applications could not be counted">
          {({ recent }) => (
            <SummaryCard
              label="New applications"
              hint="in the last 7 days"
              value={recent}
              href={applicantsPath(lang, slug, { sort: "applied", dir: "desc" })}
              icon={Users}
            />
          )}
        </Panel>
        <div className="sm:col-span-2 xl:col-span-1">
          <Panel promise={plan} errorTitle="The plan could not be loaded">
            {(value) => <PlanCard plan={value} now={now} billingHref={billingHref} />}
          </Panel>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-12">
        <div className="grid gap-6 lg:col-span-7 xl:col-span-8">
          <Suspense fallback={null}>
            <NoVacanciesYet empty={empty} lang={lang} slug={slug} role={role} />
          </Suspense>
          <Panel promise={applications} errorTitle="The applicants by stage could not be counted">
            {(value) => (
              <StageTable
                id="stage-heading"
                title="Applicants by stage"
                description="Every application of every vacancy, counted now"
                countLabel="Applicants"
                totals={value.byStage}
                total={value.total}
                hrefFor={(stage) => applicantsPath(lang, slug, { stage })}
              />
            )}
          </Panel>
        </div>
        <div className="grid gap-6 lg:col-span-5 xl:col-span-4">
          {firstSteps ? (
            <Panel promise={firstSteps} errorTitle="The first steps could not be loaded">
              {(steps) =>
                twoStepDone && steps.vacancyPublished && steps.teamInvited && steps.planChosen ? null : (
                  <GuidedSteps lang={lang} organizationSlug={slug} twoStepDone={twoStepDone} steps={steps} />
                )
              }
            </Panel>
          ) : null}
          {quickActions}
        </div>
      </div>
    </div>
  );
}
