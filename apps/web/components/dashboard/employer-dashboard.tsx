import { BriefcaseBusiness } from "lucide-react";
import { Suspense } from "react";
import { Panel } from "@/components/dashboard/panel";
import { PlanAlerts } from "@/components/dashboard/plan-alerts";
import { PlanCard } from "@/components/dashboard/plan-card";
import { StageTable } from "@/components/dashboard/stage-table";
import { SummaryCard } from "@/components/dashboard/summary-card";
import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { LinkButton } from "@/components/layout/link-button";
import { PageHeader } from "@/components/layout/page-header";
import { GuidedSteps } from "@/components/organization/guided-steps";
import { getFirstSteps, startDashboardLoad } from "@/lib/dal/dashboard";
import { applicantsPath, billingPath, jobsPath, organizationProfilePath } from "@/lib/routes";
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

type Loads = ReturnType<typeof startDashboardLoad>;

// The two figures, each linked to the list it counts (FR-E5 AC1, AC2).
function EmployerFigures({ lang, slug, loads }: { lang: string; slug: string; loads: Pick<Loads, "vacancies" | "applications"> }) {
  return (
    <div className="animate-stagger grid gap-4 sm:grid-cols-2">
      <Panel promise={loads.vacancies} errorTitle="The active jobs could not be counted">
        {({ open }) => <SummaryCard label="Active jobs" detail="Accepting applications now" value={open} href={jobsPath(lang, slug, { status: "open" })} />}
      </Panel>
      <Panel promise={loads.applications} errorTitle="The new applications could not be counted">
        {({ recent }) => (
          <SummaryCard label="New applications" hint="in the last 7 days" value={recent} href={applicantsPath(lang, slug, { sort: "applied", dir: "desc" })} />
        )}
      </Panel>
    </div>
  );
}

// The summary of the hiring of one organisation for a member, or for an owner or admin at aal2. The reads start together;
// each part shows its own when it is ready, or its own error. An owner or admin also sees the first steps until they are
// all done. The stage counts are shown once, in the table of the applications.
export function EmployerDashboard({ lang, organization, twoStepDone }: EmployerDashboardProps) {
  const { slug, role } = organization;
  const { applications, vacancies, plan, empty } = startDashboardLoad(organization.id);
  const manager = role !== "member";
  const firstSteps = manager ? getFirstSteps(organization.id) : null;
  const billingHref = manager ? billingPath(lang, slug) : null;
  const now = new Date();

  return (
    <div className="grid gap-section">
      <PageHeader
        title="Dashboard"
        actions={
          manager ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <TextLink standalone href={organizationProfilePath(lang, slug)}>
                Company profile
              </TextLink>
              <TextLink standalone href={billingPath(lang, slug)}>
                Billing
              </TextLink>
              <LinkButton href={`${jobsPath(lang, slug)}/new`} size="default">
                Post job
              </LinkButton>
            </div>
          ) : null
        }
      />

      <Panel promise={plan} errorTitle="The plan could not be loaded" quiet>
        {(value) => <PlanAlerts plan={value} now={now} slug={slug} billingHref={billingHref} />}
      </Panel>

      <EmployerFigures lang={lang} slug={slug} loads={{ applications, vacancies }} />

      <Panel promise={plan} errorTitle="The plan could not be loaded">
        {(value) => <PlanCard plan={value} now={now} billingHref={billingHref} />}
      </Panel>

      <div className="animate-stagger grid items-start gap-6 lg:grid-cols-12">
        <div className="grid gap-6 lg:col-span-7 xl:col-span-8">
          <Suspense fallback={null}>
            <NoVacanciesYet empty={empty} lang={lang} slug={slug} role={role} />
          </Suspense>
          <Panel promise={applications} errorTitle="The applicants by stage could not be counted">
            {(value) => (
              <StageTable
                id="stage-heading"
                title="Applications"
                countLabel="Applicants"
                totals={value.byStage}
                total={value.total}
                hrefFor={(stage) => applicantsPath(lang, slug, { stage })}
              />
            )}
          </Panel>
        </div>
        {firstSteps ? (
          <div className="lg:col-span-5 xl:col-span-4">
            <Panel promise={firstSteps} errorTitle="The first steps could not be loaded">
              {(steps) =>
                twoStepDone && steps.vacancyPublished && steps.teamInvited && steps.planChosen ? null : (
                  <GuidedSteps lang={lang} organizationSlug={slug} twoStepDone={twoStepDone} steps={steps} />
                )
              }
            </Panel>
          </div>
        ) : null}
      </div>
    </div>
  );
}
