import { Link } from "@react-email/components";
import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

function unreadText(payload: Record<string, unknown>): string {
  const count = Number(field(payload, "unread"));
  if (!Number.isInteger(count) || count < 1) return "new messages";
  return count === 1 ? "1 unread message" : `${count} unread messages`;
}

// FR-P4 AC5, AC10 (FR-T1 AC2, AC8): messages stayed unread for the delay. The payload holds the conversation id, the
// other party as the recipient already sees it, the context title, the unread count and, for an organisation, the slug of
// the recipient's own organisation; never a message text.
export const newMessage: Template = {
  subject: (payload) => {
    const sender = field(payload, "sender_name");
    return sender ? `You have ${unreadText(payload)} from ${sender}` : `You have ${unreadText(payload)}`;
  },
  Body: ({ payload, siteUrl }) => {
    const sender = field(payload, "sender_name") ?? "The other party";
    const title = field(payload, "context_title");
    const id = field(payload, "conversation_id");
    const slug = field(payload, "org_slug");
    const inbox = slug === undefined ? "/messages" : /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? `/org/${slug}/messages` : null;
    return (
      <Layout preview={`${sender} sent you a message`} heading="You have unread messages">
        <Paragraph>
          {sender} sent you {unreadText(payload)}
          {title ? ` about "${title}"` : ""}. For your privacy the messages are only shown on the site.
        </Paragraph>
        {inbox && id && /^[0-9a-f-]{36}$/.test(id) ? (
          <Action href={url(siteUrl, `${inbox}/${id}`)}>Read the conversation</Action>
        ) : null}
        <Paragraph>
          You get one email per conversation when a message stays unread for a while.{" "}
          <Link href={url(siteUrl, "/settings/notifications")}>Turn off message emails</Link>
        </Paragraph>
      </Layout>
    );
  },
};
