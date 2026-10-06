import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DocumentReminders } from "@/components/documents/document-reminders";
import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { GuidedSteps } from "@/components/organization/guided-steps";
import { CompletenessCard } from "@/components/passport/completeness-card";
import { getDocumentReminders, getUsableCvs } from "@/lib/dal/documents";
import { hasVerifiedTotpFactor } from "@/lib/dal/mfa";
import { getMyOrganizations } from "@/lib/dal/organizations";
import { getPassport } from "@/lib/dal/passport";
import { requireUser } from "@/lib/dal/session";
import { computeCompleteness } from "@/lib/passport/completeness";
import { dashboardSegments, homePath, isDashboardSegment } from "@/lib/routes";
import { todayUtc } from "@/lib/validation/passport";

export const metadata: Metadata = { title: "Dashboard — CHARA" };

export default async function DashboardPage({ params }: PageProps<"/[lang]/dashboard/[kind]">) {
  const { lang, kind } = await params;
  if (!isDashboardSegment(kind)) notFound();
  const user = await requireUser(lang);
  if (user.accountKind !== dashboardSegments[kind]) {
    redirect(homePath(lang, user.accountKind));
  }
  if (kind === "worker") {
    const [passport, reminders, cvs] = await Promise.all([getPassport(user.id), getDocumentReminders(), getUsableCvs()]);
    if (!passport) redirect(`/${lang}/onboarding`);
    const today = todayUtc();
    return (
      <AuthCard title="Dashboard" description={`Welcome, ${passport.firstName}`}>
        <CompletenessCard lang={lang} completeness={computeCompleteness({ ...passport, documents: cvs }, today)} />
        <DocumentReminders lang={lang} reminders={reminders} today={today} />
      </AuthCard>
    );
  }

  const [organizations, twoStepDone] = await Promise.all([
    getMyOrganizations(user.id),
    hasVerifiedTotpFactor(lang),
  ]);
  const [organization, ...others] = organizations;
  if (!organization) {
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
  return (
    <AuthCard title="Dashboard" description={organization.displayName}>
      <EmptyState title="Nothing here yet" description="Follow these steps to get started.">
        <GuidedSteps lang={lang} organizationSlug={organization.slug} twoStepDone={twoStepDone} />
      </EmptyState>
      {others.length > 0 ? (
        <nav aria-label="Your organizations" className="grid gap-1">
          <p className="text-sm text-muted-foreground">You also belong to</p>
          {others.map((other) => (
            <TextLink key={other.id} href={`/${lang}/org/${other.slug}`}>
              {other.displayName}
            </TextLink>
          ))}
        </nav>
      ) : null}
    </AuthCard>
  );
}
