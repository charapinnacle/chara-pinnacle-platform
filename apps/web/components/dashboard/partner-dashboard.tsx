import { BlockCard } from "@/components/dashboard/block-card";
import { DateText } from "@/components/dashboard/date-text";
import { Panel } from "@/components/dashboard/panel";
import { PartnerActivity } from "@/components/dashboard/partner-activity";
import { PartnerReviewCard } from "@/components/dashboard/partner-review-card";
import { PartnerWorkforceListings } from "@/components/dashboard/partner-workforce-listings";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { PageHeader } from "@/components/layout/page-header";
import { CommitmentGate } from "@/components/organization/commitment-gate";
import type { OrgUsage } from "@/lib/billing/limits";
import { organizationUnread } from "@/lib/dashboard/connections";
import {
  dashboardQuestions,
  nextActions,
  planUsageKeys,
  usageAttention,
  usageLine,
  type NextActionTarget,
  type PartnerFigures,
} from "@/lib/dashboard/partner-dashboard";
import { planStatusLabels, planStatusTones } from "@/lib/dashboard/plan-status";
import { segmentOf } from "@/lib/dashboard/segments";
import { getCommitmentBlock } from "@/lib/dal/commitment";
import { getFollowerCount } from "@/lib/dal/connections";
import { getDashboardPlan, type DashboardPlan } from "@/lib/dal/dashboard";
import { getUnreadMessageCounts } from "@/lib/dal/messaging";
import { hasVerifiedTotpFactor } from "@/lib/dal/mfa";
import { getPartnerFigures } from "@/lib/dal/partner-dashboard";
import { getPartnerReview, getReviewOutcome, getReviewTargetDays } from "@/lib/dal/partner-review";
import { getCountries, getOccupations } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { getOrgUsage } from "@/lib/dal/usage";
import { getAvailabilityRules, getWorkforceListings } from "@/lib/dal/workforce-availability";
import {
  billingPath,
  companyDashboardPath,
  findWorkersPath,
  mfaPath,
  onboardingPath,
  partnerStepPath,
  workforceProfilePath,
  workforceProfilePreviewPath,
} from "@/lib/routes";
import type { PartnerType } from "@/lib/validation/sign-up";
import type { MemberRole } from "@/lib/validation/team";

type PartnerDashboardProps = {
  lang: string;
  user: { aal: string };
  organization: { id: string; slug: string; displayName: string; role: MemberRole; type: PartnerType };
};

// The way each partner type adds to its capacity (spec §30): Update Workforce Capacity for a recruitment company, Add
// Workforce for a staffing company. Both open the availability of the workforce profile, where listings are added.
const capacityAction = {
  recruitment_company: "Update recruiting capacity",
  staffing_company: "Add workforce",
} as const satisfies Record<PartnerType, string>;

type Links = Record<NextActionTarget, string>;

// The workforce profile names the reason with the same id, so the next action leads to it.
const COMMITMENT_REASON_ID = "commitment-reason";

function NextActionsCard({
  figures,
  canManage,
  links,
  type,
}: {
  figures: PartnerFigures;
  canManage: boolean;
  links: Links;
  type: PartnerType;
}) {
  const actions = nextActions(figures, canManage, type);
  return (
    <BlockCard id="next-actions-heading" title="Next actions">
      {actions.length > 0 ? (
        <ul className="grid gap-2">
          {actions.map((action) => (
            <li key={action.id}>
              <TextLink standalone href={links[action.target]}>
                {action.text}
              </TextLink>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-muted-foreground">
          {canManage
            ? "Nothing needs your attention now. Keep your listings confirmed so employers see your current capacity."
            : "Your owner or an administrator keeps the profile, listings and licences of your company up to date."}
        </p>
      )}
    </BlockCard>
  );
}

type PlanUsageProps = {
  plan: DashboardPlan;
  usage: OrgUsage;
  usageKeys: readonly string[];
  type: PartnerType;
  billingHref: string | null;
  // Release 2b is on, so a free plan has its responses and submissions paused (FR-R3 AC9).
  paused: boolean;
};

// The plan as one slim line near the top (FR-R3 AC9, FR-R4 AC8): its name and state, every usage figure that org_usage
// counts in a row, the ones at or over their limit or not in the plan marked, and the way to billing for the owner and
// admins. The full detail is on the billing page.
function PlanLine({ plan, usage, usageKeys, type, billingHref, paused }: PlanUsageProps) {
  const free = plan.status === "free";
  const lines = usageKeys.flatMap((key) => {
    const line = usageLine(usage, key, type);
    return line ? [{ key, line, attention: usageAttention(usage, key) }] : [];
  });
  const flagged = lines.filter(({ attention }) => attention !== null);
  const summary =
    free && paused
      ? "Responses and submissions are paused"
      : flagged.length > 0
        ? flagged.map(({ line, attention }) => `${line} · ${attention === "over_limit" ? "over the limit" : "limit reached"}`).join(", ")
        : "Within your plan's limits";
  return (
    <section aria-label="Plan and usage" className="grid gap-2 rounded-xl border bg-card px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 sm:flex-nowrap">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-body">
          <span className="font-semibold">{free ? "Free plan" : plan.planName}</span>
          {free ? null : (
            <StatusBadge status={planStatusTones[plan.status]}>
              <span className="sr-only">Status: </span>
              {planStatusLabels[plan.status]}
            </StatusBadge>
          )}
          {plan.status === "trialing" && plan.trialEndsAt ? (
            <span className="text-small text-muted-foreground">
              Free month ends <DateText date={plan.trialEndsAt} />
            </span>
          ) : null}
          <span className="text-small text-muted-foreground">· {summary}</span>
        </p>
        {billingHref ? (
          <TextLink standalone href={billingHref} className="shrink-0">
            {free ? "Choose a plan" : flagged.length > 0 ? "Upgrade" : "Manage plan"}
          </TextLink>
        ) : free ? (
          <p className="shrink-0 text-small text-muted-foreground">An owner or admin chooses the plan.</p>
        ) : null}
      </div>
      <details className="text-small text-muted-foreground">
        <summary className="w-fit cursor-pointer rounded-sm hover:text-foreground">See usage</summary>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2" aria-label="Usage of your plan">
          {lines.map(({ key, line, attention }) => (
            <li key={key} className={attention ? "font-medium text-foreground" : undefined}>
              {line}
              {attention ? (attention === "over_limit" ? " · over the limit" : " · limit reached") : null}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

// The dashboard of a recruitment or staffing company (FR-R3, FR-R4), release 2a blocks: while release 2b is on, an
// employer-pays commitment not accepted in its current version, with the owner's dialog or who acts (FR-J3 AC4, FR-S4 AC7,
// V52; read quietly, without a skeleton, because most partners hold a current acceptance and the next actions name a
// missing one too); the next actions, the review
// and listing state, the workforce profile, profile views, followers, licences, the team, the available workforce and
// the plan with its usage. Every figure is read from the database on each request and each part loads, fails and
// retries on its own. The pages of spec §30's actions are in the sidebar, so the header repeats none of them. While
// release 2b is on (V55) the blocks fitting job orders or workforce requests with the matching employers, invitations, responses with their decisions (projects) and submissions by stage with their
// outcomes join the figures. While release 2c is on (V75) the partner requests and unread messages (messaging) and the
// matching workers (Find Workers) join them, the unread messages from a read of their own (FR-R3 AC11); until a release
// is on its blocks and actions are absent, not shown as zero. A member sees
// every block but none of the actions of the owner and admins. Owners and admins see the plan once at aal2, as on the
// billing page (FR-A4).
export async function PartnerDashboard({ lang, user, organization }: PartnerDashboardProps) {
  const { id, slug, role, type } = organization;
  const canManage = role !== "member";
  const planLocked = canManage && user.aal !== "aal2";
  const availabilityHref = `${workforceProfilePath(lang, slug)}#availability-heading`;
  const licencesHref = `${workforceProfilePath(lang, slug)}#licences-heading`;
  const billingHref = canManage ? billingPath(lang, slug) : null;
  const links: Links = {
    profile: workforceProfilePath(lang, slug),
    availability: availabilityHref,
    licences: licencesHref,
    onboarding: onboardingPath(lang),
    company: partnerStepPath(lang, "company"),
    commitment: `${workforceProfilePath(lang, slug)}#${COMMITMENT_REASON_ID}`,
  };
  const action = { label: capacityAction[type], href: availabilityHref };

  const figures = getPartnerFigures(id);
  const jobOrdersReleased = isReleased("release_job_orders");
  const commitment = jobOrdersReleased.then((released) => (released ? getCommitmentBlock(id) : null));
  const review = Promise.all([getPartnerReview(id), getReviewOutcome(id), getReviewTargetDays()]);
  // The follower count of a listed company (FR-L4 AC11), never who follows; nothing while it is not listed.
  // A failed review read is reported once, by the review card; the followers then show nothing.
  const followers = review.then(
    ([state]) => (state && state.listedAt !== null && state.status !== "declined" ? getFollowerCount(id) : null),
    () => null,
  );
  const listings = Promise.all([getWorkforceListings(id), getAvailabilityRules(), getOccupations(), getCountries()]);
  const [twoStepDone, jobOrders, submissionsOn, messaging] = await Promise.all([
    planLocked ? hasVerifiedTotpFactor(lang) : false,
    jobOrdersReleased,
    isReleased("release_candidate_submissions"),
    isReleased("release_messaging"),
  ]);
  const dashboardHref = companyDashboardPath(lang, segmentOf(type), slug);
  const unread = messaging && !planLocked ? getUnreadMessageCounts().then((counts) => organizationUnread(counts, id)) : null;
  // Read inside the figures, which are not drawn when they fail to load; the failure is then not left unhandled.
  void unread?.catch(() => undefined);
  // The submission pages need both switches, as submissionsReleased says.
  const submissions = jobOrders && submissionsOn;
  const usageKeys = planUsageKeys({ jobOrders, submissions });
  const plan = planLocked ? null : Promise.all([getDashboardPlan(id), getOrgUsage(id, usageKeys)]);
  const now = new Date().toISOString();

  const recruitment = type === "recruitment_company";
  // The listings: a staffing company's available workforce leads its work, a recruitment company's recruiting capacity
  // follows its job orders.
  const workforceSection = (
    <section aria-labelledby="workforce-heading" className="grid gap-4">
      <h2 id="workforce-heading" className="text-h2">
        {organization.type === "recruitment_company" ? "Recruiting capacity" : "Available workforce"}
      </h2>
      <Panel promise={listings} errorTitle="The available workforce could not be loaded">
        {([rows, rules, occupations, countries]) => (
          <PartnerWorkforceListings
            slug={slug}
            canManage={canManage}
            listings={rows}
            names={{
              occupations: Object.fromEntries(occupations.map((item) => [item.code, item.label])),
              countries: Object.fromEntries(countries.map((item) => [item.code, item.name])),
            }}
            rules={rules}
            action={action}
            now={now}
            recruiter={organization.type === "recruitment_company"}
          />
        )}
      </Panel>
    </section>
  );

  return (
    <div className="grid gap-section">
      <PageHeader
        title={dashboardQuestions[type]}
        breadcrumb={
          <p className="text-small font-medium tracking-wide text-muted-foreground uppercase">
            {organization.displayName} · {recruitment ? "Recruitment company" : "Staffing company"}
          </p>
        }
      />

      <Panel promise={commitment} errorTitle="The employer-pays commitment could not be loaded" quiet>
        {(value) =>
          value ? <CommitmentGate slug={slug} owner={role === "owner"} commitment={value} reasonId={COMMITMENT_REASON_ID} /> : null
        }
      </Panel>

      <Panel promise={review} errorTitle="The review state could not be loaded">
        {([state, outcome, targetDays]) =>
          state && state.status !== "onboarding" ? (
            <PartnerReviewCard
              lang={lang}
              organization={organization}
              status={state.status}
              wasListed={state.listedAt !== null}
              outcome={outcome}
              targetDays={targetDays}
              canManage={canManage}
            />
          ) : null
        }
      </Panel>

      {plan ? (
        <Panel promise={plan} errorTitle="The plan and its usage could not be loaded">
          {([planValue, usage]) => (
            <PlanLine plan={planValue} usage={usage} usageKeys={usageKeys} type={type} billingHref={billingHref} paused={jobOrders} />
          )}
        </Panel>
      ) : (
        <Notice tone="info">
          {twoStepDone ? (
            <>
              Enter your two-step code to see your plan and its usage.{" "}
              <TextLink href={mfaPath(lang, dashboardHref)}>
                Enter your code
              </TextLink>
            </>
          ) : (
            "Owners and admins see the plan and its usage once two-step verification is set up."
          )}
        </Notice>
      )}

      <Panel promise={figures} errorTitle="The figures of your company could not be loaded">
        {(value) => (
          <>
            {value.profileHidden ? (
              <Notice tone="warning" role="status" className="mb-section">
                Our team has hidden your profile from the partner directories.{" "}
                <TextLink href={workforceProfilePath(lang, slug)}>See why on your workforce profile</TextLink>
              </Notice>
            ) : null}
            <NextActionsCard figures={value} canManage={canManage} links={links} type={organization.type} />
          </>
        )}
      </Panel>

      {recruitment ? null : workforceSection}

      <Panel promise={figures} errorTitle="The figures of your company could not be loaded" quiet>
        {(value) => (
          <PartnerActivity
            lang={lang}
            slug={slug}
            recruitment={recruitment}
            network={value.network}
            submissionStages={value.submissionStages}
            requests={value.requests}
            matchingWorkers={value.matchingWorkers}
            findWorkersHref={findWorkersPath(lang, slug)}
            unread={messaging ? (unread ? { count: unread } : { lockedHref: mfaPath(lang, dashboardHref) }) : null}
            company={{
              licencesCurrent: value.licencesCurrent,
              licencesExpiring: value.licencesExpiring,
              licencesExpired: value.licencesExpired,
              licencesHref,
              views: !value.profileViewsInPlan
                ? null
                : value.profileViewsFewerThan !== null
                  ? { fewerThan: value.profileViewsFewerThan }
                  : { count: value.profileViews ?? 0 },
              viewsHref: workforceProfilePreviewPath(lang, slug),
              followers,
            }}
          />
        )}
      </Panel>

      {recruitment ? workforceSection : null}
    </div>
  );
}
