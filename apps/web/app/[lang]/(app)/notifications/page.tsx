import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { PageHeader } from "@/components/layout/page-header";
import { NotificationList } from "@/components/notifications/notification-list";
import { getEmailUndeliverable, listMyNotifications } from "@/lib/dal/notifications";
import { isReleased } from "@/lib/dal/release";
import { requireUser } from "@/lib/dal/session";
import { homePath, notificationSettingsPath, notificationsPath } from "@/lib/routes";
import { parseListCursor } from "@/lib/validation/job";

export const metadata: Metadata = { title: "Notifications", robots: { index: false } };

// For workers and company users while release 2a is switched on; before that the address does not exist.
export default async function NotificationsPage({ params, searchParams }: PageProps<"/[lang]/notifications">) {
  const { lang } = await params;
  const user = await requireUser(lang);
  if (user.accountKind === null) redirect(homePath(lang, null));
  if (!(await isReleased("release_partner_directories"))) notFound();

  const cursor = parseListCursor((await searchParams).cursor);
  const [{ items, nextCursor }, undeliverable] = await Promise.all([listMyNotifications(cursor), getEmailUndeliverable()]);

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader
        title="Notifications"
        description="Updates about your account and your work on the platform, newest first."
        actions={
          <TextLink standalone href={notificationSettingsPath(lang)}>
            Notification settings
          </TextLink>
        }
      />
      {undeliverable ? (
        <Notice tone="warning" role="status">
          <p className="font-semibold">We could not deliver email to your address</p>
          <p>Check that your email address is correct. Until it changes, notifications are shown here only.</p>
        </Notice>
      ) : null}
      <NotificationList
        lang={lang}
        accountKind={user.accountKind}
        items={items}
        renderedAt={new Date().toISOString()}
        nextHref={nextCursor ? notificationsPath(lang, nextCursor) : null}
        firstHref={cursor ? notificationsPath(lang) : null}
      />
    </div>
  );
}
