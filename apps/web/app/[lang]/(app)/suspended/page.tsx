import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/dal/session";
import { homePath } from "@/lib/routes";

export const metadata: Metadata = { title: "Account suspended — CHARA", robots: { index: false } };

export default async function SuspendedPage({ params }: PageProps<"/[lang]/suspended">) {
  const { lang } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/${lang}/login`);
  if (!user.suspended) redirect(homePath(lang, user.accountKind));
  return (
    <div className="grid max-w-xl gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">Your account is suspended</h1>
      <p>See the email we sent you for the reasons and how to respond.</p>
    </div>
  );
}
