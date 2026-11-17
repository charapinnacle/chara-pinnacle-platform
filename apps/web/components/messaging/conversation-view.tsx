import { notFound } from "next/navigation";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { PageHeader } from "@/components/layout/page-header";
import { BlockControl } from "@/components/messaging/block-control";
import { ConversationThread } from "@/components/messaging/conversation-thread";
import type { ComposerOrganization } from "@/components/messaging/message-composer";
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
import { reportPath } from "@/lib/routes";
import { WORKERS_NEVER_PAY } from "@/lib/validation/commitment";
import { parseMessageMaxChars } from "@/lib/validation/messaging";

type ConversationViewProps = {
  lang: string;
  viewer: MessagingViewer;
  conversationId: string;
  // The organisation of the address, which must be the caller's side of the conversation; null for the candidate.
  organizationId: string | null;
  // The organisation a member sends for, for the upgrade prompt at its monthly limit; null for the candidate.
  organization: ComposerOrganization | null;
  breadcrumb: (counterpart: string) => React.ReactNode;
};

// One conversation (FR-P1 AC8 to AC11; SOP P2-26 steps Send, Read, Context link; NFR-U4): the header names the other
// party and the context with a link to its page, the status says whether messages can be sent and, if not, why and what
// comes next; then the thread. A conversation of another side of the caller (the candidate's own under an organisation's
// address, or another organisation's) is not found here. Either side may block it (FR-P3 AC8), and a conversation with a
// candidate shows the "Workers never pay" notice with a way to report a fee request (FR-P3 AC11, FR-J3).
export async function ConversationView({ lang, viewer, conversationId, organizationId, organization, breadcrumb }: ConversationViewProps) {
  const conversation = await getConversation(conversationId);
  if (!conversation || conversation.organizationId !== organizationId) notFound();
  const [messages, settings] = await Promise.all([listMessages(conversation.id), getPublicSettings()]);
  const counterpart = counterpartLabel(conversation);
  const href = contextHref(lang, viewer, conversation);
  const closed = conversation.readOnlyReason ? readOnlyText(viewer, conversation.readOnlyReason, conversation.blockedByMe) : null;
  const withWorker = viewer.kind === "worker" || conversation.counterpartKind === "worker";
  // The company's last message on the first page that the reader did not write: what a fee request is reported on.
  const feeRequest = withWorker ? messages.find((message) => message.senderKind === "organization" && !message.mine) : undefined;

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
        {conversation.readOnlyReason === null || conversation.blockedByMe ? (
          <BlockControl conversationId={conversation.id} counterpart={counterpart} blockedByMe={conversation.blockedByMe} />
        ) : null}
      </PageHeader>
      <ConversationThread
        lang={lang}
        conversationId={conversation.id}
        counterpart={counterpart}
        initialMessages={messages}
        maxChars={closed ? null : parseMessageMaxChars(settings.message_body_max_chars)}
        organization={organization}
        notice={
          withWorker ? (
            <Notice tone="info" className="grid gap-1">
              <p>{WORKERS_NEVER_PAY}.</p>
              {feeRequest ? (
                <p>
                  <TextLink href={reportPath(lang, "message", feeRequest.id, "fee_demanded_from_worker")}>Report a fee request</TextLink>
                </p>
              ) : null}
            </Notice>
          ) : null
        }
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
