import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

// FR-P2 AC11 (step Invite to job): a company the worker talks to invites them to apply to one of its vacancies. The
// payload holds the connection, the conversation, the company's display name and the vacancy's title, city and country;
// never the text or the member who sent it.
export const jobInvitation: Template = {
  subject: (payload) => `${field(payload, "org_name") ?? "A company"} invites you to apply`,
  Body: ({ payload, siteUrl }) => {
    const organization = field(payload, "org_name") ?? "A company";
    const title = field(payload, "job_title");
    const place = [field(payload, "city"), field(payload, "country_name")].filter(Boolean).join(", ");
    const id = field(payload, "conversation_id");
    return (
      <Layout preview={`${organization} invites you to apply`} heading="You are invited to apply">
        <Paragraph>
          {organization} invites you to apply to {title ? `"${title}"` : "one of its vacancies"}
          {place ? ` in ${place}` : ""}. Applying works as for any vacancy: you choose what you share.
        </Paragraph>
        {id && /^[0-9a-f-]{36}$/.test(id) ? <Action href={url(siteUrl, `/messages/${id}`)}>See the invitation</Action> : null}
      </Layout>
    );
  },
};
