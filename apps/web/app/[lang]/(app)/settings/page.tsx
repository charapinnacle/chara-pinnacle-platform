import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TextLink } from "@/components/forms/text-link";
import { Section } from "@/components/layout/section";
import { DeleteAccount } from "@/components/settings/delete-account";
import { getDeletionStatus } from "@/lib/dal/account-closure";
import { requireUser } from "@/lib/dal/session";
import { homePath } from "@/lib/routes";

export const metadata: Metadata = { title: "Settings — CHARA", robots: { index: false } };

export default async function SettingsPage({ params }: PageProps<"/[lang]/settings">) {
  const { lang } = await params;
  // A candidate who still has to accept a new version of the terms can ask for deletion all the same.
  const user = await requireUser(lang, { consentGate: false });
  if (user.accountKind !== "worker") redirect(homePath(lang, user.accountKind));
  const status = await getDeletionStatus();

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Settings</h1>
        <TextLink standalone href={homePath(lang, "worker")}>
          Back to the dashboard
        </TextLink>
      </header>
      <Section
        id="delete-account"
        title="Delete account"
        description="Ask us to erase your profile and documents. You have time to change your mind."
      >
        <DeleteAccount {...status} />
      </Section>
    </div>
  );
}
