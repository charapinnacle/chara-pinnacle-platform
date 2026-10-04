import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/dal/session";
import { homePath } from "@/lib/routes";

export const metadata: Metadata = { title: "Dashboard — CHARA" };

export default async function DashboardPage({ params }: PageProps<"/[lang]/dashboard/[kind]">) {
  const { lang, kind } = await params;
  if (kind !== "worker" && kind !== "employer") notFound();
  const user = await requireUser(lang);
  if (user.accountKind !== (kind === "worker" ? "worker" : "company")) {
    redirect(homePath(lang, user.accountKind));
  }
  return <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>;
}
