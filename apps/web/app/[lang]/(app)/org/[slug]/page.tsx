import type { Metadata } from "next";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { requireOrgRole } from "@/lib/dal/session";
import { jobsPath } from "@/lib/routes";
import { roleLabels } from "@/lib/validation/team";

export const metadata: Metadata = { title: "Organization — CHARA", robots: { index: false } };

export default async function OrganizationPage({ params }: PageProps<"/[lang]/org/[slug]">) {
  const { lang, slug } = await params;
  const { organization } = await requireOrgRole(lang, slug, "member");
  return (
    <AuthCard title={organization.displayName} description={`Your role: ${roleLabels[organization.role]}`}>
      <TextLink standalone href={jobsPath(lang, slug)}>
        Vacancies
      </TextLink>
      <TextLink standalone href={`/${lang}/org/${slug}/members`}>
        Team
      </TextLink>
    </AuthCard>
  );
}
