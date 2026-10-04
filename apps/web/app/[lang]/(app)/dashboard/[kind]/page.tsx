import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EmptyState } from "@/components/feedback/empty-state";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { GuidedSteps } from "@/components/organization/guided-steps";
import { hasVerifiedTotpFactor } from "@/lib/dal/mfa";
import { getMyOrganization } from "@/lib/dal/organizations";
import { requireUser } from "@/lib/dal/session";
import { dashboardSegments, homePath, isDashboardSegment } from "@/lib/routes";

export const metadata: Metadata = { title: "Dashboard — CHARA" };

export default async function DashboardPage({ params }: PageProps<"/[lang]/dashboard/[kind]">) {
  const { lang, kind } = await params;
  if (!isDashboardSegment(kind)) notFound();
  const user = await requireUser(lang);
  if (user.accountKind !== dashboardSegments[kind]) {
    redirect(homePath(lang, user.accountKind));
  }
  if (kind !== "employer") return <AuthCard title="Dashboard" />;

  const organization = await getMyOrganization(user.id);
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
        <GuidedSteps twoStepDone={await hasVerifiedTotpFactor()} />
      </EmptyState>
    </AuthCard>
  );
}
