import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { DataExportPanel } from "@/components/settings/data-export";
import { listMyDataExports } from "@/lib/dal/data-export";
import { isReleased } from "@/lib/dal/release";
import { requireUser } from "@/lib/dal/session";
import { homePath, notificationSettingsPath, settingsPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Download my data", robots: { index: false } };

// A copy of the user's own data (FR-S3 AC8, GDPR Art. 15 and 20), for every signed-in account. A user who still has to
// accept a new version of the terms can ask all the same. Release 2a only.
export default async function DataExportPage({ params }: PageProps<"/[lang]/settings/data-export">) {
  const { lang } = await params;
  const user = await requireUser(lang, { consentGate: false });
  if (!(await isReleased("release_partner_directories"))) notFound();
  const data = await listMyDataExports();
  const settings =
    user.accountKind === "worker"
      ? { label: "Settings", href: settingsPath(lang) }
      : { label: "Notification settings", href: notificationSettingsPath(lang) };

  return (
    <div className="grid w-full max-w-3xl gap-page">
      <PageHeader
        title="Download my data"
        breadcrumb={
          <Breadcrumbs
            items={[{ label: "Dashboard", href: homePath(lang, user.accountKind) }, settings, { label: "Download my data" }]}
          />
        }
      />
      <Section
        id="data-export"
        title="A copy of your data"
        description="One file with the data we hold about you: your account, profile, documents, applications, consents, notifications and activity, in a machine-readable format (JSON)."
      >
        <DataExportPanel {...data} />
      </Section>
    </div>
  );
}
