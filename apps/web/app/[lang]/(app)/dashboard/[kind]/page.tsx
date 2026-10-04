import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
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
  return <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>;
}
