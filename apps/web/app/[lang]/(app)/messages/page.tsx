import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MessagesInbox } from "@/components/messaging/messages-inbox";
import { isReleased } from "@/lib/dal/release";
import { requireCandidate } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Messages", robots: { index: false } };

// The candidate's conversations with employers (FR-P1 AC10), while release 2c is on; before that the address does not exist.
export default async function MessagesPage({ params, searchParams }: PageProps<"/[lang]/messages">) {
  const [{ lang }, raw] = await Promise.all([params, searchParams]);
  if (!(await isReleased("release_messaging"))) notFound();
  const user = await requireCandidate(lang);
  return <MessagesInbox lang={lang} viewer={{ kind: "worker" }} userId={user.id} organizationId={null} searchParams={raw} />;
}
