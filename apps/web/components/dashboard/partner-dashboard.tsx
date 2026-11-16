import { DateText } from "@/components/dashboard/date-text";
import { Panel } from "@/components/dashboard/panel";
import { PartnerReviewCard } from "@/components/dashboard/partner-review-card";
import { PartnerWorkforceListings } from "@/components/dashboard/partner-workforce-listings";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { LinkButton } from "@/components/layout/link-button";
import { PageHeader } from "@/components/layout/page-header";
import type { OrgUsage } from "@/lib/billing/limits";
import { followerCountText, type FollowerCount } from "@/lib/connections/access";
import {
  dashboardQuestions,
  missingPartLabels,
  nextActions,
  planUsageKeys,
  profileViewsText,
  segmentOf,
  usageLine,
  type NextActionTarget,
  type PartnerFigures,
} from "@/lib/dashboard/partner-dashboard";
import { planStatusLabels, planStatusTones } from "@/lib/dashboard/plan-status";
import { getFollowerCount } from "@/lib/dal/connections";
import { getDashboardPlan, type DashboardPlan } from "@/lib/dal/dashboard";
import { hasVerifiedTotpFactor } from "@/lib/dal/mfa";
import { getPartnerFigures } from "@/lib/dal/partner-dashboard";
import { getPartnerReview, getReviewOutcome, getReviewTargetDays } from "@/lib/dal/partner-review";
import { getCountries, getOccupations } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { getOrgUsage } from "@/lib/dal/usage";
import { getAvailabilityRules, getWorkforceListings } from "@/lib/dal/workforce-availability";
import { formatCount, formatDate } from "@/lib/i18n/format";
import {
  billingPath,
  companyDashboardPath,
  findEmployersPath,
  followingPath,
  jobOrdersPath,
  membersPath,
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
  recruitment_company: "Update workforce capacity",
  staffing_company: "Add workforce",
} as const satisfies Record<PartnerType, string>;

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-small text-muted-foreground">{label}</dt>
      <dd className="text-body font-medium">{children}</dd>
    </div>
  );
}

function BlockCard({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Card as="section" padding="lg" aria-labelledby={id} className="content-start gap-3">
      <h2 id={id} className="text-h3">
        {title}
      </h2>
      {children}
    </Card>
  );
}

type Links = Record<NextActionTarget, string>;

function NextActionsCard({ figures, canManage, links }: { figures: PartnerFigures; canManage: boolean; links: Links }) {
  const actions = nextActions(figures, canManage);
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

function ProfileCard({ figures, lang, slug, canManage }: { figures: PartnerFigures; lang: string; slug: string; canManage: boolean }) {
  const listing = !figures.listed
    ? "Not listed yet"
    : figures.profileHidden
      ? "Hidden from the partner directories by our team"
      : "Listed in the partner directories";
  return (
    <BlockCard id="profile-heading" title="Workforce profile">
      <dl className="grid gap-3">
        <Figure label="Listing">{listing}</Figure>
        <Figure label="Profile">
          {figures.profileMissing ? `Missing ${missingPartLabels[figures.profileMissing] ?? "some details"}` : "Complete"}
        </Figure>
        {figures.profileUpdatedAt ? (
          <Figure label="Last updated">
            <DateText date={new Date(figures.profileUpdatedAt)} />
          </Figure>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <TextLink standalone href={workforceProfilePath(lang, slug)}>
          {canManage ? "Edit your workforce profile" : "See your workforce profile"}
        </TextLink>
        <TextLink standalone href={workforceProfilePreviewPath(lang, slug)}>
          Preview your public profile
        </TextLink>
      </div>
    </BlockCard>
  );
}

function ViewsCard({ figures, billingHref }: { figures: PartnerFigures; billingHref: string | null }) {
  let body: React.ReactNode;
  if (!figures.profileViewsInPlan) {
    body = (
      <>
        <p className="text-body text-muted-foreground">Your plan does not include profile view counts. The paid partner plans do.</p>
        {billingHref ? (
          <TextLink standalone href={billingHref}>
            Compare plans
          </TextLink>
        ) : null}
      </>
    );
  } else if (figures.profileViews === 0) {
    body = <p className="text-body text-muted-foreground">Views appear here once employers open your profile.</p>;
  } else {
    body = (
      <>
        <dl>
          <Figure label="Profile views in the last 30 days">
            <span className="text-figure tabular-nums">{profileViewsText(figures)}</span>
          </Figure>
        </dl>
        <p className="text-small text-muted-foreground">Counted once per company and day. No one sees who viewed a profile.</p>
      </>
    );
  }
  return (
    <BlockCard id="views-heading" title="Profile views">
      {body}
    </BlockCard>
  );
}

function LicencesCard({ figures, href, canManage }: { figures: PartnerFigures; href: string; canManage: boolean }) {
  const none = figures.licencesCurrent + figures.licencesExpired === 0;
  return (
    <BlockCard id="licences-heading" title="Licences">
      {none ? (
        <p className="text-body text-muted-foreground">
          No licences recorded yet. Add the licence or registration you hold for each country where you recruit or supply workers.
        </p>
      ) : (
        <dl className="grid gap-3">
          <Figure label="Current licences">{formatCount(figures.licencesCurrent)}</Figure>
          {figures.nextLicenceExpiry ? <Figure label="Next expiry">{formatDate(figures.nextLicenceExpiry)}</Figure> : null}
        </dl>
      )}
      {figures.licencesExpiring > 0 ? (
        <p>
          <StatusBadge status="warning">
            {formatCount(figures.licencesExpiring)} {figures.licencesExpiring === 1 ? "licence expires" : "licences expire"} soon
          </StatusBadge>
        </p>
      ) : null}
      {figures.licencesExpired > 0 ? (
        <p>
          <StatusBadge status="danger">
            {formatCount(figures.licencesExpired)} {figures.licencesExpired === 1 ? "licence has" : "licences have"} expired
          </StatusBadge>
        </p>
      ) : null}
      <TextLink standalone href={href}>
        {canManage ? (none ? "Add a licence" : "Manage your licences") : "See your licences"}
      </TextLink>
    </BlockCard>
  );
}

function NetworkCard({ followers, lang }: { followers: FollowerCount; lang: string }) {
  return (
    <BlockCard id="network-heading" title="Your network">
      <p className="text-body">{followerCountText(followers)}</p>
      <p className="text-small text-muted-foreground">Only the number is shown: no one sees who follows a company.</p>
      <TextLink standalone href={followingPath(lang)}>
        Companies you follow
      </TextLink>
    </BlockCard>
  );
}

// The team of the company (FR-J1 AC11): the owner and admins invite colleagues there, a member sees who is in it.
function TeamCard({ href, canManage }: { href: string; canManage: boolean }) {
  return (
    <BlockCard id="team-heading" title="Your team">
      <p className="text-body text-muted-foreground">
        {canManage
          ? "Invite colleagues to keep your workforce profile, listings and licences up to date with you."
          : "See who works on your company's profile with you."}
      </p>
      <TextLink standalone href={href}>
        {canManage ? "Invite your team" : "See your team"}
      </TextLink>
    </BlockCard>
  );
}

type PlanUsageProps = { plan: DashboardPlan; usage: OrgUsage; type: PartnerType; billingHref: string | null };

// The plan and its usage against the limits of release 2a (FR-R3 AC9, FR-R4 AC8): the usage figures are those that
// org_usage counts, as on the billing page. Only the owner and admins get the way to billing.
function PlanUsageCard({ plan, usage, type, billingHref }: PlanUsageProps) {
  const free = plan.status === "free";
  const lines = planUsageKeys.flatMap((key) => {
    const line = usageLine(usage, key, type);
    return line ? [{ key, line }] : [];
  });
  return (
    <BlockCard id="plan-heading" title="Plan and usage">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-h3">{plan.planName}</span>
        <StatusBadge status={planStatusTones[plan.status]}>
          <span className="sr-only">Status: </span>
          {planStatusLabels[plan.status]}
        </StatusBadge>
      </p>
      {plan.status === "trialing" && plan.trialEndsAt ? (
        <p className="text-small text-muted-foreground">
          Free month ends <DateText date={plan.trialEndsAt} />
        </p>
      ) : null}
      <ul className="grid gap-1" aria-label="Usage of your plan">
        {lines.map(({ key, line }) => (
          <li key={key} className="text-body">
            {line}
          </li>
        ))}
      </ul>
      {billingHref ? (
        <TextLink standalone href={billingHref}>
          {free ? "Choose a plan" : "Manage plan"}
        </TextLink>
      ) : free ? (
        <p className="text-small text-muted-foreground">Contact an owner or admin of your company to choose a plan.</p>
      ) : null}
    </BlockCard>
  );
}

// The dashboard of a recruitment or staffing company (FR-R3, FR-R4), release 2a blocks: the next actions, the review
// and listing state, the workforce profile, profile views, followers, licences, the team, the available workforce and
// the plan with its usage. Every figure is read from the database on each request and each part loads, fails and
// retries on its own. While release 2b is on the header links the job order marketplace (V40) and Find employers (V53).
// The blocks of job orders, invitations, submissions, projects, partner requests, matching employers and unread
// messages, and the actions Submit candidates, Find companies and Respond to request, come with their releases (V55, V75); until
// then they are absent, not shown as zero. A member sees
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
  };
  const action = { label: capacityAction[type], href: availabilityHref };

  const figures = getPartnerFigures(id);
  const review = Promise.all([getPartnerReview(id), getReviewOutcome(id), getReviewTargetDays()]);
  // The follower count of a listed company (FR-L4 AC11), never who follows; nothing while it is not listed.
  // A failed review read is reported once, by the review card; the followers then show nothing.
  const followers = review.then(
    ([state]) => (state && state.listedAt !== null && state.status !== "declined" ? getFollowerCount(id) : null),
    () => null,
  );
  const listings = Promise.all([getWorkforceListings(id), getAvailabilityRules(), getOccupations(), getCountries()]);
  const plan = planLocked ? null : Promise.all([getDashboardPlan(id), getOrgUsage(id, planUsageKeys)]);
  const [twoStepDone, jobOrders] = await Promise.all([
    planLocked ? hasVerifiedTotpFactor(lang) : false,
    isReleased("release_job_orders"),
  ]);
  const now = new Date().toISOString();

  return (
    <div className="grid gap-section">
      <PageHeader
        title={dashboardQuestions[type]}
        description={organization.displayName}
        actions={
          jobOrders || canManage ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              {jobOrders ? (
                <>
                  <TextLink standalone href={jobOrdersPath(lang, slug)}>
                    Job orders
                  </TextLink>
                  <TextLink standalone href={findEmployersPath(lang, slug)}>
                    Find employers
                  </TextLink>
                </>
              ) : null}
              {canManage ? <LinkButton href={action.href}>{action.label}</LinkButton> : null}
            </div>
          ) : null
        }
      />

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

      <Panel promise={figures} errorTitle="The figures of your company could not be loaded">
        {(value) => (
          <div className="animate-stagger grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            <NextActionsCard figures={value} canManage={canManage} links={links} />
            <ProfileCard figures={value} lang={lang} slug={slug} canManage={canManage} />
            <ViewsCard figures={value} billingHref={billingHref} />
            <LicencesCard figures={value} href={licencesHref} canManage={canManage} />
            <TeamCard href={membersPath(lang, slug)} canManage={canManage} />
          </div>
        )}
      </Panel>

      <Panel promise={followers} errorTitle="The follower count could not be loaded">
        {(value) => (value ? <NetworkCard followers={value} lang={lang} /> : null)}
      </Panel>

      <section aria-labelledby="workforce-heading" className="grid gap-4">
        <h2 id="workforce-heading" className="text-h2">
          Available workforce
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
            />
          )}
        </Panel>
      </section>

      {plan ? (
        <Panel promise={plan} errorTitle="The plan and its usage could not be loaded">
          {([planValue, usage]) => <PlanUsageCard plan={planValue} usage={usage} type={type} billingHref={billingHref} />}
        </Panel>
      ) : (
        <Notice tone="info">
          {twoStepDone ? (
            <>
              Enter your two-step code to see your plan and its usage.{" "}
              <TextLink href={mfaPath(lang, companyDashboardPath(lang, segmentOf(type), slug))}>
                Enter your code
              </TextLink>
            </>
          ) : (
            "Owners and admins see the plan and its usage once two-step verification is set up."
          )}
        </Notice>
      )}
    </div>
  );
}
