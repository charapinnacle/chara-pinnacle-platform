import { notFound } from "next/navigation";
import { InviteToJob } from "@/components/connections/invite-to-job";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { LinkButton } from "@/components/layout/link-button";
import { PageHeader } from "@/components/layout/page-header";
import { BlockControl } from "@/components/messaging/block-control";
import { ConversationThread } from "@/components/messaging/conversation-thread";
import type { ComposerOrganization } from "@/components/messaging/message-composer";
import { listConversationConnections } from "@/lib/dal/connection-actions";
import { listOpenVacancies } from "@/lib/dal/contact-requests";
import { getConversation, listMessages } from "@/lib/dal/messaging";
import { getPublicSettings } from "@/lib/dal/settings";
import { getSubmissionTarget, submissionsReleased } from "@/lib/dal/submissions";
import {
  contextHref,
  contextLabels,
  contextLinkLabel,
  counterpartLabel,
  readOnlyText,
  type MessagingViewer,
} from "@/lib/messaging/present";
import { newSubmissionPath, reportPath } from "@/lib/routes";
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
  const [messages, settings, connections] = await Promise.all([
    listMessages(conversation.id),
    getPublicSettings(),
    listConversationConnections(conversation.id),
  ]);
  const counterpart = counterpartLabel(conversation);
  const href = contextHref(lang, viewer, conversation);
  const closed = conversation.readOnlyReason ? readOnlyText(viewer, conversation.readOnlyReason, conversation.blockedByMe) : null;
  const withWorker = viewer.kind === "worker" || conversation.counterpartKind === "worker";
  // The company's last message on the first page that the reader did not write: what a fee request is reported on.
  const feeRequest = withWorker ? messages.find((message) => message.senderKind === "organization" && !message.mine) : undefined;
  const actions = await connectionActions(lang, viewer, conversation, organizationId, closed !== null);

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
        {actions.vacancies.length > 0 && viewer.kind !== "worker" ? (
          <InviteToJob
            slug={viewer.slug}
            target={{ conversationId: conversation.id }}
            workerLabel={counterpart}
            vacancies={actions.vacancies}
          />
        ) : null}
        {actions.submitHref ? <LinkButton href={actions.submitHref}>Submit candidate</LinkButton> : null}
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
        connections={connections}
        reader={viewer.kind === "worker" ? "worker" : "organization"}
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

// The structured actions the reader may take here (FR-P2 AC4, AC6; SOP steps Invite to job and Submit candidate): an
// organisation invites the worker of an open conversation to one of its open vacancies; a partner submits a candidate in
// the conversation of a requirement where the employer allows it (FR-O4's form).
async function connectionActions(
  lang: string,
  viewer: MessagingViewer,
  conversation: { contextType: string; counterpartKind: string; requirementId: string | null },
  organizationId: string | null,
  closed: boolean,
): Promise<{ vacancies: { id: string; title: string }[]; submitHref: string | null }> {
  if (viewer.kind === "worker" || !organizationId) return { vacancies: [], submitHref: null };
  const vacancies = conversation.counterpartKind === "worker" && !closed ? await listOpenVacancies(organizationId) : [];
  const partnerRequirement =
    viewer.kind === "partner" &&
    conversation.requirementId &&
    (conversation.contextType === "requirement_invitation" || conversation.contextType === "partner_response")
      ? conversation.requirementId
      : null;
  const target = partnerRequirement && (await submissionsReleased()) ? await getSubmissionTarget(organizationId, partnerRequirement) : null;
  return {
    vacancies,
    submitHref: target?.open ? newSubmissionPath(lang, viewer.slug, target.requirementId) : null,
  };
}
