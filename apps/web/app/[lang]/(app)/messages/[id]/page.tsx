import type { Metadata } from "next";
import { notFound } from "next/navigation";
import * as z from "zod";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ConversationView } from "@/components/messaging/conversation-view";
import { isReleased } from "@/lib/dal/release";
import { requireCandidate } from "@/lib/dal/session";
import { messagesPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Conversation", robots: { index: false } };

// One of the candidate's conversations (FR-P1 AC8 to AC11), while release 2c is on. A conversation the candidate takes no
// part in and an unknown id are not found alike.
export default async function CandidateConversationPage({ params }: PageProps<"/[lang]/messages/[id]">) {
  const { lang, id } = await params;
  if (!(await isReleased("release_messaging"))) notFound();
  await requireCandidate(lang);
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) notFound();
  return (
    <ConversationView
      lang={lang}
      viewer={{ kind: "worker" }}
      conversationId={parsedId.data}
      organizationId={null}
      breadcrumb={(counterpart) => <Breadcrumbs items={[{ label: "Messages", href: messagesPath(lang, null) }, { label: counterpart }]} />}
    />
  );
}
