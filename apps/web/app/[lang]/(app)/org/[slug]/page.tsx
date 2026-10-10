import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/layout/auth-card";
import { requireOrgRole } from "@/lib/dal/session";
import { employerDashboardPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Organization — CHARA", robots: { index: false } };

// The pages of an organisation are in the header, so this address only leads to the dashboard of the organisation (where
// an accepted invitation lands), or says that the organisation is suspended.
export default async function OrganizationPage({ params }: PageProps<"/[lang]/org/[slug]">) {
  const { lang, slug } = await params;
  const { organization } = await requireOrgRole(lang, slug, "member");
  if (!organization.suspended) redirect(employerDashboardPath(lang, slug));
  return (
    <AuthCard
      title="This organisation is suspended"
      description="Its vacancies, applicants and billing are not available. See the email we sent the owner and administrators for the reasons and how to respond."
    />
  );
}
