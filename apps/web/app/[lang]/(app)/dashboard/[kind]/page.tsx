import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { employerEntry } from "@/components/dashboard/employer-entry";
import { PartnerDashboard } from "@/components/dashboard/partner-dashboard";
import { WorkerDashboard } from "@/components/dashboard/worker-dashboard";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { ReportOutcomes } from "@/components/reports/report-outcomes";
import { dashboardTarget, type CompanySegment } from "@/lib/dashboard/partner-dashboard";
import { getDocumentReminders, hasUsableCv } from "@/lib/dal/documents";
import { getMyOrganizations } from "@/lib/dal/organizations";
import { getPartnerReview } from "@/lib/dal/partner-review";
import { getPassport } from "@/lib/dal/passport";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole, requireUser, type CurrentUser } from "@/lib/dal/session";
import { computeCompleteness } from "@/lib/passport/completeness";
import { companyDashboardPath, dashboardSegments, homePath, isDashboardSegment, onboardingPath } from "@/lib/routes";
import { todayUtc } from "@/lib/validation/passport";
import { partnerTypeSchema } from "@/lib/validation/sign-up";

export const metadata: Metadata = { title: "Dashboard" };

// Whether the dashboard of a recruitment or staffing company is open: release 2a is on and the company was submitted for
// review (FR-J1 AC11). Before that its onboarding is where it goes.
async function partnerDashboardOpen(organizationId: string): Promise<boolean> {
  if (!(await isReleased("release_partner_directories"))) return false;
  const review = await getPartnerReview(organizationId);
  return review !== null && review.status !== "onboarding";
}

// The dashboard of a company account follows the type of the organisation it shows (FR-R3 AC2, FR-R4 AC2): a recruitment
// or staffing company is rendered here, an employer is left to the employer dashboard (null), and any other combination
// of segment and organisation is redirected. A partner account without an organisation, or whose organisation is not
// submitted yet, is sent to its onboarding; a partner account in an employer organisation (one that joined before
// invitations checked the type) keeps the employer dashboard, so it never bounces between this page and onboarding.
async function companyDashboard(lang: string, user: CurrentUser, segment: CompanySegment, slug: string | undefined) {
  const organizations = await getMyOrganizations(user.id);
  if (organizations.length === 0 && partnerTypeSchema.safeParse(user.intendedOrganizationType).success) {
    redirect(onboardingPath(lang));
  }
  const target = dashboardTarget(segment, slug, organizations);
  if (target.kind === "employer") return null;
  if (target.kind === "redirect") {
    const destination = organizations.find((organization) => organization.slug === target.slug);
    // From the employer segment the onboarding of a company not yet submitted comes first, as before release 2a.
    if (segment === "employer" && destination && destination.type !== "employer" && !(await partnerDashboardOpen(destination.id))) {
      redirect(onboardingPath(lang));
    }
    redirect(companyDashboardPath(lang, target.segment, target.slug));
  }
  // The partner dashboards are pages of release 2a, as the other partner pages.
  if (!(await isReleased("release_partner_directories"))) notFound();
  if (!(await partnerDashboardOpen(target.organization.id))) redirect(onboardingPath(lang));
  const { organization } = await requireOrgRole(lang, target.organization.slug, "member", {
    mfa: false,
    partner: true,
    hideFromOutsiders: true,
  });
  if (organization.suspended) return <SuspendedOrganization title="Dashboard" subject="figures" />;
  return <PartnerDashboard lang={lang} user={user} organization={{ ...organization, type: target.organization.type }} />;
}

export default async function DashboardPage({ params, searchParams }: PageProps<"/[lang]/dashboard/[kind]">) {
  const [{ lang, kind }, { org }] = await Promise.all([params, searchParams]);
  if (!isDashboardSegment(kind)) notFound();
  const user = await requireUser(lang);
  if (user.accountKind !== dashboardSegments[kind]) {
    redirect(homePath(lang, user.accountKind));
  }
  const slug = typeof org === "string" ? org : undefined;
  if (kind !== "worker") {
    const partner = await companyDashboard(lang, user, kind, slug);
    if (partner) return partner;
  }
  const outcomes = (
    <Suspense fallback={null}>
      <ReportOutcomes lang={lang} />
    </Suspense>
  );
  if (kind === "worker") {
    const [passport, reminders, hasCv, network, findWorkers] = await Promise.all([
      getPassport(user.id),
      getDocumentReminders(),
      hasUsableCv(),
      isReleased("release_partner_directories"),
      isReleased("release_find_workers"),
    ]);
    if (!passport) redirect(`/${lang}/onboarding`);
    const today = todayUtc();
    return (
      <>
        {outcomes}
        <WorkerDashboard
          lang={lang}
          completeness={computeCompleteness({ ...passport, hasCv }, today, findWorkers)}
          availability={passport.availability}
          availableFrom={passport.availableFrom}
          reminders={reminders}
          today={today}
          network={network}
          findWorkers={findWorkers}
        />
      </>
    );
  }

  return (
    <>
      {outcomes}
      {await employerEntry(lang, user, slug)}
    </>
  );
}
