import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { MessagesInbox } from "@/components/messaging/messages-inbox";
import { organizationCrumb } from "@/lib/app/navigation";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Messages", robots: { index: false } };

// The conversations of an employer or of a recruitment or staffing company (FR-P1 AC10; SOP P2-26 step Members), for every
// member while release 2c is on; owners and admins at aal2, as for applicant data. A suspended organisation still reads its
// conversations, which are closed for new messages until it is reinstated.
export default async function OrganizationMessagesPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/messages">) {
  const [{ lang, slug }, raw] = await Promise.all([params, searchParams]);
  if (!(await isReleased("release_messaging"))) notFound();
  const { user, organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true, partner: "either" });
  return (
    <MessagesInbox
      lang={lang}
      viewer={{ kind: organization.type === "employer" ? "employer" : "partner", slug }}
      userId={user.id}
      organizationId={organization.id}
      breadcrumb={<Breadcrumbs items={[organizationCrumb(lang, organization), { label: "Messages" }]} />}
      searchParams={raw}
    />
  );
}
