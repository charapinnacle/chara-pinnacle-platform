import { Suspense } from "react";
import {
  EmployerSubmissionsCard,
  FollowedCompaniesCard,
  PartnersCard,
  RequirementsCard,
  ResponsesWaitingCard,
  SavedPartnersCard,
} from "@/components/dashboard/employer-network-blocks";
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
import { RequirementUsage } from "@/components/requirements/requirement-usage";
import { EMPLOYER_NETWORK_QUESTION } from "@/lib/dashboard/employer-network";
import { getFirstSteps, startDashboardLoad } from "@/lib/dal/dashboard";
import { getEmployerNetwork } from "@/lib/dal/employer-network";
import { getUsagePrompts } from "@/lib/dal/usage";
import { RECRUITMENT_DIRECTORY_PATH } from "@/lib/public/navigation";
import { ACTIVE_REQUIREMENTS } from "@/lib/requirements/limits";
import { applicantsPath, billingPath, findWorkersPath, jobsPath, organizationProfilePath, requirementsPath } from "@/lib/routes";
import type { MemberRole } from "@/lib/validation/team";

type EmployerDashboardProps = {
  lang: string;
  organization: { id: string; slug: string; displayName: string; role: MemberRole };
  twoStepDone: boolean;
  // Release 2a is on: the partner network part shows, with the saved partners and followed companies (FR-L4 AC10, FR-R5).
  network: boolean;
  // Release 2b is on: the workforce requirements are linked (FR-M1, SOP step Start).
  requirements: boolean;
  // Find Workers is released: the search is linked (FR-Q2 SOP step Open).
  findWorkers?: boolean;
};

async function NoVacanciesYet({ empty, lang, slug, role }: { empty: Promise<boolean>; lang: string; slug: string; role: MemberRole }) {
  if (!(await empty)) return null;
  if (role === "member") {
    return <EmptyState title="No vacancies yet" description="An owner or admin creates the vacancies of your company." />;
  }
  return (
    <EmptyState title="Nothing here yet" description="Publish a vacancy and its applications will be counted here.">
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
        {({ open }) => <SummaryCard label="Active jobs" value={open} href={jobsPath(lang, slug, { status: "open" })} />}
      </Panel>
      <Panel promise={loads.applications} errorTitle="The new applications could not be counted">
        {({ recent }) => (
          <SummaryCard label="New applications" hint="in the last 7 days" value={recent} href={applicantsPath(lang, slug, { sort: "applied", dir: "desc" })} />
        )}
      </Panel>
    </div>
  );
}

type PartnerNetworkProps = { lang: string; organizationId: string; slug: string; canManage: boolean; requirements: boolean };

// "Who can help me fill my workforce requirement?" (spec §30, FR-R5) after the Phase 1 blocks (AC2): one read for every
// figure of the partner network, so its failure leaves the hiring figures in place (AC10). The blocks of release 2b come
// only with job orders and the submitted candidates only with candidate submissions (AC7).
function PartnerNetwork({ lang, organizationId, slug, canManage, requirements }: PartnerNetworkProps) {
  const findPartnersHref = `/${lang}/${RECRUITMENT_DIRECTORY_PATH}`;
  return (
    <section aria-labelledby="network-heading" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h2 id="network-heading" className="text-h2">
          {EMPLOYER_NETWORK_QUESTION}
        </h2>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          {requirements && canManage ? (
            <TextLink standalone href={`${requirementsPath(lang, slug)}/new`}>
              Post workforce requirement
            </TextLink>
          ) : null}
          <TextLink standalone href={findPartnersHref}>
            Find partners
          </TextLink>
        </div>
      </div>
      <Panel promise={getEmployerNetwork(organizationId)} errorTitle="The partner network figures could not be loaded">
        {(value) => (
          <div className="animate-stagger grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            {value.requirements ? (
              <>
                <RequirementsCard figures={value.requirements} lang={lang} slug={slug} canManage={canManage} />
                <ResponsesWaitingCard figures={value.requirements} lang={lang} slug={slug} />
                <PartnersCard figures={value.requirements} findPartnersHref={findPartnersHref} />
              </>
            ) : null}
            {value.submissionStages ? <EmployerSubmissionsCard stages={value.submissionStages} lang={lang} slug={slug} /> : null}
            <SavedPartnersCard count={value.savedPartners} findPartnersHref={findPartnersHref} lang={lang} slug={slug} />
            <FollowedCompaniesCard count={value.followedCompanies} findPartnersHref={findPartnersHref} lang={lang} />
          </div>
        )}
      </Panel>
    </section>
  );
}

// The summary of the hiring of one organisation for a member, or for an owner or admin at aal2. The reads start together;
// each part shows its own when it is ready, or its own error. An owner or admin also sees the first steps until they are
// all done. The stage counts are shown once, in the table of the applications.
export function EmployerDashboard({ lang, organization, twoStepDone, network, requirements, findWorkers = false }: EmployerDashboardProps) {
  const { slug, role } = organization;
  const { applications, vacancies, plan, empty } = startDashboardLoad(organization.id);
  const manager = role !== "member";
  const firstSteps = manager ? getFirstSteps(organization.id) : null;
  const billingHref = manager ? billingPath(lang, slug) : null;
  const requirementUsage = requirements ? getUsagePrompts(organization.id, "employer", [ACTIVE_REQUIREMENTS]) : null;
  // Read inside the plan card, which is not drawn when the plan fails to load; the failure is then not left unhandled.
  void requirementUsage?.catch(() => undefined);
  const now = new Date();

  return (
    <div className="grid gap-section">
      <PageHeader
        title="Dashboard"
        actions={
          manager || requirements || findWorkers ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              {requirements ? (
                <TextLink standalone href={requirementsPath(lang, slug)}>
                  Workforce requirements
                </TextLink>
              ) : null}
              {findWorkers ? (
                <TextLink standalone href={findWorkersPath(lang, slug)}>
                  Find workers
                </TextLink>
              ) : null}
              {manager ? (
                <>
                  <TextLink standalone href={organizationProfilePath(lang, slug)}>
                    Company profile
                  </TextLink>
                  <TextLink standalone href={billingPath(lang, slug)}>
                    Billing
                  </TextLink>
                  <LinkButton href={`${jobsPath(lang, slug)}/new`} size="default">
                    Post job
                  </LinkButton>
                </>
              ) : null}
            </div>
          ) : null
        }
      />

      <Panel promise={plan} errorTitle="The plan could not be loaded" quiet>
        {(value) => <PlanAlerts plan={value} now={now} slug={slug} billingHref={billingHref} />}
      </Panel>

      <EmployerFigures lang={lang} slug={slug} loads={{ applications, vacancies }} />

      <Panel promise={plan} errorTitle="The plan could not be loaded">
        {(value) => (
          <PlanCard plan={value} now={now} billingHref={billingHref}>
            {requirementUsage ? (
              <Panel promise={requirementUsage} errorTitle="The open workforce requirements could not be counted">
                {(prompts) => (
                  <RequirementUsage
                    organizationId={organization.id}
                    prompt={prompts[ACTIVE_REQUIREMENTS]}
                    billingHref={billingPath(lang, slug)}
                    canUpgrade={manager}
                  />
                )}
              </Panel>
            ) : null}
          </PlanCard>
        )}
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

      {network ? (
        <PartnerNetwork lang={lang} organizationId={organization.id} slug={slug} canManage={manager} requirements={requirements} />
      ) : null}
    </div>
  );
}
