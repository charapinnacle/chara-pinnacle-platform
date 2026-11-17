import { notFound } from "next/navigation";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { PageHeader } from "@/components/layout/page-header";
import { ConversationThread } from "@/components/messaging/conversation-thread";
import { getConversation, listMessages } from "@/lib/dal/messaging";
import { getPublicSettings } from "@/lib/dal/settings";
import {
  contextHref,
  contextLabels,
  contextLinkLabel,
  counterpartLabel,
  readOnlyText,
  type MessagingViewer,
} from "@/lib/messaging/present";
import { parseMessageMaxChars } from "@/lib/validation/messaging";

type ConversationViewProps = {
  lang: string;
  viewer: MessagingViewer;
  conversationId: string;
  // The organisation of the address, which must be the caller's side of the conversation; null for the candidate.
  organizationId: string | null;
  breadcrumb: (counterpart: string) => React.ReactNode;
};

// One conversation (FR-P1 AC8 to AC11; SOP P2-26 steps Send, Read, Context link; NFR-U4): the header names the other
// party and the context with a link to its page, the status says whether messages can be sent and, if not, why and what
// comes next; then the thread. A conversation of another side of the caller (the candidate's own under an organisation's
// address, or another organisation's) is not found here.
export async function ConversationView({ lang, viewer, conversationId, organizationId, breadcrumb }: ConversationViewProps) {
  const conversation = await getConversation(conversationId);
  if (!conversation || conversation.organizationId !== organizationId) notFound();
  const [messages, settings] = await Promise.all([listMessages(conversation.id), getPublicSettings()]);
  const counterpart = counterpartLabel(conversation);
  const href = contextHref(lang, viewer, conversation);
  const closed = conversation.readOnlyReason ? readOnlyText(viewer, conversation.readOnlyReason) : null;

  return (
    <div className="grid w-full max-w-3xl gap-section">
      <PageHeader title={counterpart} breadcrumb={breadcrumb(counterpart)}>
        <p className="text-body text-muted-foreground wrap-anywhere">
          {contextLabels[conversation.contextType]}
          {conversation.contextTitle ? `: ${conversation.contextTitle}` : null}
        </p>
        {href ? (
          <p>
            <TextLink standalone href={href}>
              {contextLinkLabel(viewer, conversation.contextType)}
            </TextLink>
          </p>
        ) : null}
      </PageHeader>
      <ConversationThread
        conversationId={conversation.id}
        counterpart={counterpart}
        initialMessages={messages}
        maxChars={closed ? null : parseMessageMaxChars(settings.message_body_max_chars)}
      >
        {closed ? (
          <Notice tone="info" role="status">
            <p className="font-semibold">{closed.title}</p>
            <p>{closed.next}</p>
          </Notice>
        ) : null}
      </ConversationThread>
    </div>
  );
}
