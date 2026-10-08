import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { employerEntry } from "@/components/dashboard/employer-entry";
import { DocumentReminders } from "@/components/documents/document-reminders";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";
import { CompletenessCard } from "@/components/passport/completeness-card";
import { getDocumentReminders, hasUsableCv } from "@/lib/dal/documents";
import { getPassport } from "@/lib/dal/passport";
import { requireUser } from "@/lib/dal/session";
import { savedPath } from "@/lib/jobs/saved";
import { computeCompleteness } from "@/lib/passport/completeness";
import { applicationsPath, dashboardSegments, homePath, isDashboardSegment, notificationSettingsPath, settingsPath } from "@/lib/routes";
import { todayUtc } from "@/lib/validation/passport";

export const metadata: Metadata = { title: "Dashboard — CHARA" };

export default async function DashboardPage({ params, searchParams }: PageProps<"/[lang]/dashboard/[kind]">) {
  const [{ lang, kind }, { org }] = await Promise.all([params, searchParams]);
  if (!isDashboardSegment(kind)) notFound();
  const user = await requireUser(lang);
  if (user.accountKind !== dashboardSegments[kind]) {
    redirect(homePath(lang, user.accountKind));
  }
  if (kind === "worker") {
    const [passport, reminders, hasCv] = await Promise.all([getPassport(user.id), getDocumentReminders(), hasUsableCv()]);
    if (!passport) redirect(`/${lang}/onboarding`);
    const today = todayUtc();
    return (
      <AuthCard title="Dashboard" description={`Welcome, ${passport.firstName}`}>
        <div className="grid gap-4">
          <h2 className="text-lg font-semibold">Your passport</h2>
          <CompletenessCard lang={lang} completeness={computeCompleteness({ ...passport, hasCv }, today)} />
          <TextLink standalone href={`/${lang}/passport`}>
            Open your passport
          </TextLink>
          <TextLink standalone href={applicationsPath(lang)}>
            My applications
          </TextLink>
          <TextLink standalone href={savedPath(lang)}>
            Saved vacancies
          </TextLink>
          <TextLink standalone href={notificationSettingsPath(lang)}>
            Notification settings
          </TextLink>
          <TextLink standalone href={settingsPath(lang)}>
            Account settings
          </TextLink>
        </div>
        <DocumentReminders lang={lang} reminders={reminders} today={today} />
      </AuthCard>
    );
  }

  return employerEntry(lang, user, typeof org === "string" ? org : undefined);
}
