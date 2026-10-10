import type { Metadata } from "next";
import * as z from "@/lib/zod";
import { MfaResetForm } from "@/components/admin/mfa-reset-form";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { requirePlatformRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "MFA reset — CHARA", robots: { index: false } };

export default async function MfaResetPage({ params, searchParams }: PageProps<"/[lang]/admin/mfa-reset">) {
  const [{ lang }, { user }] = await Promise.all([params, searchParams]);
  await requirePlatformRole(lang, ["admin"]);
  const userId = z.uuid().safeParse(user);

  return (
    <div className="grid gap-page">
      <PageHeader title="MFA reset" />
      <Section
        id="reset"
        title="Reset two-step verification"
        description="Only after you have checked the identity of the person. Their authenticator is removed, they are signed out on every device and told by email, and they set it up again at the next sign-in."
      >
        <MfaResetForm userId={userId.success ? userId.data : ""} />
      </Section>
    </div>
  );
}
