import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { employerEntry } from "@/components/dashboard/employer-entry";
import { WorkerDashboard } from "@/components/dashboard/worker-dashboard";
import { getDocumentReminders, hasUsableCv } from "@/lib/dal/documents";
import { getPassport } from "@/lib/dal/passport";
import { requireUser } from "@/lib/dal/session";
import { computeCompleteness } from "@/lib/passport/completeness";
import { dashboardSegments, homePath, isDashboardSegment } from "@/lib/routes";
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
      <WorkerDashboard
        lang={lang}
        firstName={passport.firstName}
        completeness={computeCompleteness({ ...passport, hasCv }, today)}
        reminders={reminders}
        today={today}
      />
    );
  }

  return employerEntry(lang, user, typeof org === "string" ? org : undefined);
}
