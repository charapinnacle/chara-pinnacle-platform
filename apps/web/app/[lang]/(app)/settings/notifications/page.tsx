import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TextLink } from "@/components/forms/text-link";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { NotificationForm } from "@/components/settings/notification-form";
import { getEmailDelivery } from "@/lib/dal/notifications";
import { requireUser } from "@/lib/dal/session";
import { homePath } from "@/lib/routes";

export const metadata: Metadata = { title: "Notification settings — CHARA", robots: { index: false } };

export default async function NotificationSettingsPage({ params }: PageProps<"/[lang]/settings/notifications">) {
  const { lang } = await params;
  const user = await requireUser(lang);
  if (user.accountKind !== "worker" && user.accountKind !== "company") redirect(homePath(lang, user.accountKind));
  const delivery = user.accountKind === "company" ? await getEmailDelivery() : null;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-page">
      <PageHeader title="Notification settings">
        <TextLink standalone href={homePath(lang, user.accountKind)}>
          Back to the dashboard
        </TextLink>
      </PageHeader>
      {delivery ? (
        <Section
          id="new-applications"
          title="New applications"
          description="Choose how you hear about applications to your vacancies. This applies to you only."
        >
          <NotificationForm delivery={delivery} />
        </Section>
      ) : (
        <Section
          id="application-updates"
          title="Application updates"
          description="We email you whenever the stage of an application changes, except when an employer opens it."
        >
          <p className="text-body">Application status emails are always sent. They cannot be switched off.</p>
        </Section>
      )}
    </div>
  );
}
