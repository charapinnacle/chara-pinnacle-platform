import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { EmailKindsForm } from "@/components/settings/email-kinds-form";
import { NotificationForm } from "@/components/settings/notification-form";
import { getEmailDelivery, getNotificationKinds } from "@/lib/dal/notifications";
import { isReleased } from "@/lib/dal/release";
import { requireUser } from "@/lib/dal/session";
import { homePath, settingsPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Notification settings", robots: { index: false } };

export default async function NotificationSettingsPage({ params }: PageProps<"/[lang]/settings/notifications">) {
  const { lang } = await params;
  const user = await requireUser(lang);
  if (user.accountKind !== "worker" && user.accountKind !== "company") redirect(homePath(lang, user.accountKind));
  const [delivery, kinds] = await Promise.all([
    user.accountKind === "company" ? getEmailDelivery() : null,
    isReleased("release_partner_directories").then((released) => (released ? getNotificationKinds() : null)),
  ]);
  const optional = kinds?.filter((kind) => !kind.mandatory) ?? [];
  const mandatory = kinds?.filter((kind) => kind.mandatory) ?? [];

  return (
    <div className="grid w-full max-w-3xl gap-page">
      <PageHeader
        title="Notification settings"
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: homePath(lang, user.accountKind) },
              ...(user.accountKind === "worker" ? [{ label: "Settings", href: settingsPath(lang) }] : []),
              { label: "Notification settings" },
            ]}
          />
        }
      />
      {delivery ? (
        <Section
          id="new-applications"
          title="New applications"
          description="Choose how you hear about applications to your vacancies. This applies to you only."
        >
          {kinds ? (
            <p className="text-small text-muted-foreground">
              This choice applies only while the &ldquo;New applications&rdquo; emails are switched on under Email notifications.
            </p>
          ) : null}
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
      {kinds ? (
        <Section
          id="email-notifications"
          title="Email notifications"
          description="Every notification is shown in the app. Choose which ones are also sent to you by email."
        >
          <div className="grid gap-6">
            {optional.length > 0 ? <EmailKindsForm kinds={optional} /> : null}
            <div className="grid gap-2">
              <h3 className="font-semibold">Always sent</h3>
              <p className="text-small text-muted-foreground">These emails concern your account or your obligations and cannot be switched off.</p>
              <ul className="grid gap-1">
                {mandatory.map(({ kind, label }) => (
                  <li key={kind} className="flex flex-wrap items-center justify-between gap-x-4 border-b py-2 last:border-b-0">
                    <span>{label}</span>
                    <span className="text-small text-muted-foreground">Always sent</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>
      ) : null}
    </div>
  );
}
