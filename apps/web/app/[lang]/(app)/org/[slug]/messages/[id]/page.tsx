import type { Metadata } from "next";
import { notFound } from "next/navigation";
import * as z from "zod";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ConversationView } from "@/components/messaging/conversation-view";
import { organizationCrumb } from "@/lib/app/navigation";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { billingPath, messagesPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Conversation", robots: { index: false } };

// One conversation of the organisation (FR-P1 AC8 to AC11), for every member while release 2c is on. A conversation the
// organisation takes no part in and an unknown id are not found alike (NFR-S8).
export default async function OrganizationConversationPage({ params }: PageProps<"/[lang]/org/[slug]/messages/[id]">) {
  const { lang, slug, id } = await params;
  if (!(await isReleased("release_messaging"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true, partner: "either" });
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) notFound();
  return (
    <ConversationView
      lang={lang}
      viewer={{ kind: organization.type === "employer" ? "employer" : "partner", slug }}
      conversationId={parsedId.data}
      organizationId={organization.id}
      organization={{
        id: organization.id,
        type: organization.type,
        canUpgrade: organization.role !== "member",
        billingHref: billingPath(lang, slug),
      }}
      breadcrumb={(counterpart) => (
        <Breadcrumbs
          items={[organizationCrumb(lang, organization), { label: "Messages", href: messagesPath(lang, slug) }, { label: counterpart }]}
        />
      )}
    />
  );
}
