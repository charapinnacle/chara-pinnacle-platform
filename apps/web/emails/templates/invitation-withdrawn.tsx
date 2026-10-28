import { Link } from "@react-email/components";
import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

// FR-O1 step Withdraw: the employer withdrew an invitation of the recipient's company before a response. The payload holds
// the invitation id, the title (the generated one unless the employer shows its name) and the recipient's own slug.
export const invitationWithdrawn: Template = {
  subject: (payload) => {
    const title = field(payload, "title");
    return title ? `Invitation withdrawn: ${title}` : "An invitation to a workforce requirement was withdrawn";
  },
  Body: ({ payload, siteUrl }) => {
    const title = field(payload, "title");
    const slug = field(payload, "org_slug");
    const id = field(payload, "invitation_id");
    return (
      <Layout preview="An invitation was withdrawn" heading="An invitation was withdrawn">
        <Paragraph>
          The employer withdrew the invitation of your company to {title ? `"${title}"` : "a workforce requirement"}. You no
          longer need to answer it.
        </Paragraph>
        {slug && id && /^[0-9a-f-]{36}$/.test(id) ? (
          <Action href={url(siteUrl, `/org/${slug}/invitations/${id}`)}>See the invitation</Action>
        ) : null}
        <Paragraph>
          You can turn these emails off in your <Link href={url(siteUrl, "/settings/notifications")}>notification settings</Link>.
        </Paragraph>
      </Layout>
    );
  },
};
