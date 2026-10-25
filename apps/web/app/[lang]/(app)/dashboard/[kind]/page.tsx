import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { employerEntry } from "@/components/dashboard/employer-entry";
import { PartnerReviewDashboard } from "@/components/dashboard/partner-review-dashboard";
import { WorkerDashboard } from "@/components/dashboard/worker-dashboard";
import { ReportOutcomes } from "@/components/reports/report-outcomes";
import { getDocumentReminders, hasUsableCv } from "@/lib/dal/documents";
import { getMyOrganization } from "@/lib/dal/organizations";
import { getPartnerReview, getReviewTargetDays } from "@/lib/dal/partner-review";
import { getPassport } from "@/lib/dal/passport";
import { isReleased } from "@/lib/dal/release";
import { requireUser } from "@/lib/dal/session";
import { computeCompleteness } from "@/lib/passport/completeness";
import { dashboardSegments, homePath, isDashboardSegment, onboardingPath } from "@/lib/routes";
import { todayUtc } from "@/lib/validation/passport";
import { partnerTypeSchema } from "@/lib/validation/sign-up";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ params, searchParams }: PageProps<"/[lang]/dashboard/[kind]">) {
  const [{ lang, kind }, { org }] = await Promise.all([params, searchParams]);
  if (!isDashboardSegment(kind)) notFound();
  const user = await requireUser(lang);
  if (user.accountKind !== dashboardSegments[kind]) {
    redirect(homePath(lang, user.accountKind));
  }
  // A recruitment or staffing company has no dashboard until it is submitted for review (FR-J1 AC11): onboarding leads
  // there. Once submitted it sees the state of its review, until the partner dashboards (V30). While release 2a is off
  // its onboarding says so. A partner account in an employer organisation (one that joined before invitations checked
  // the type) keeps the employer dashboard, so it never bounces between this page and onboarding.
  if (kind === "employer" && partnerTypeSchema.safeParse(user.intendedOrganizationType).success) {
    const organization = await getMyOrganization(user.id);
    if (!organization) redirect(onboardingPath(lang));
    if (organization.type !== "employer") {
      const review = (await isReleased("release_partner_directories")) ? await getPartnerReview(organization.id) : null;
      if (!review || review.status === "onboarding") redirect(onboardingPath(lang));
      return (
        <PartnerReviewDashboard
          lang={lang}
          organization={organization}
          status={review.status}
          targetDays={await getReviewTargetDays()}
        />
      );
    }
  }
  const outcomes = (
    <Suspense fallback={null}>
      <ReportOutcomes lang={lang} />
    </Suspense>
  );
  if (kind === "worker") {
    const [passport, reminders, hasCv] = await Promise.all([getPassport(user.id), getDocumentReminders(), hasUsableCv()]);
    if (!passport) redirect(`/${lang}/onboarding`);
    const today = todayUtc();
    return (
      <>
        {outcomes}
        <WorkerDashboard
          lang={lang}
          completeness={computeCompleteness({ ...passport, hasCv }, today)}
          availability={passport.availability}
          availableFrom={passport.availableFrom}
          reminders={reminders}
          today={today}
        />
      </>
    );
  }

  return (
    <>
      {outcomes}
      {await employerEntry(lang, user, typeof org === "string" ? org : undefined)}
    </>
  );
}
