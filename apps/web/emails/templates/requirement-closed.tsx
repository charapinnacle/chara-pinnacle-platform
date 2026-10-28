import { Link } from "@react-email/components";
import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

const REASONS: Record<string, string> = {
  filled: "The employer has filled it.",
  cancelled: "The employer closed it.",
  expired: "Its closing date has passed.",
};

// FR-M2 step Close or fill: a workforce requirement the recipient's company was invited to closed or was filled. The
// payload holds the invitation id, the requirement's title, the employer's display name (revealed by the invitation), the
// reason (filled, cancelled, expired) and the recipient's own slug. To a company that responded on the marketplace (V44)
// it holds the response id instead, and the requirement's own title and the employer's name only when the employer is
// named to it (the generated title otherwise, NFR-S11).
export const requirementClosed: Template = {
  subject: (payload) => {
    const title = field(payload, "title");
    const filled = field(payload, "close_reason") === "filled";
    const relation = field(payload, "response_id") ? "you responded to" : "you are invited to";
    return title
      ? `Workforce requirement ${filled ? "filled" : "closed"}: ${title}`
      : `A workforce requirement ${relation} is ${filled ? "filled" : "closed"}`;
  },
  Body: ({ payload, siteUrl }) => {
    const title = field(payload, "title");
    const employer = field(payload, "employer_name");
    const reason = field(payload, "close_reason");
    const slug = field(payload, "org_slug");
    const response = field(payload, "response_id");
    const id = response ?? field(payload, "invitation_id");
    return (
      <Layout
        preview={`A workforce requirement you ${response ? "responded to" : "are invited to"} has ended`}
        heading="A workforce requirement has ended"
      >
        <Paragraph>
          {title ? `"${title}"` : "A workforce requirement"}
          {employer ? ` of ${employer}` : ""}, which your company {response ? "responded to" : "was invited to"}, no longer takes
          responses. {reason && Object.hasOwn(REASONS, reason) ? REASONS[reason] : ""}
        </Paragraph>
        <Paragraph>
          {response
            ? "Your response stays readable."
            : "Your company can no longer answer or respond to the invitation. Anything you already sent stays readable."}
        </Paragraph>
        {slug && id && /^[0-9a-f-]{36}$/.test(id) ? (
          <Action href={url(siteUrl, `/org/${slug}/${response ? "responses" : "invitations"}/${id}`)}>
            {response ? "See your response" : "See the invitation"}
          </Action>
        ) : null}
        <Paragraph>
          You can turn these emails off in your <Link href={url(siteUrl, "/settings/notifications")}>notification settings</Link>.
        </Paragraph>
      </Layout>
    );
  },
};
