import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, longDate, url } from "../payload.ts";
import type { Template } from "../template.ts";

// FR-M2 step Expire: the employer's owners and admins are told before an open requirement closes, with the way to
// extend it. The payload holds the requirement id, its title, the closing date and the slug of the recipient's company.
export const requirementClosingSoon: Template = {
  subject: (payload) => {
    const title = field(payload, "title");
    const date = longDate(field(payload, "closes_on"));
    return `${title ? `"${title}"` : "Your workforce requirement"} closes ${date ? `on ${date}` : "soon"}`;
  },
  Body: ({ payload, siteUrl }) => {
    const title = field(payload, "title");
    const date = longDate(field(payload, "closes_on"));
    const slug = field(payload, "org_slug");
    const id = field(payload, "requirement_id");
    return (
      <Layout preview={`A workforce requirement closes ${date ? `on ${date}` : "soon"}`} heading="A workforce requirement closes soon">
        <Paragraph>
          {title ? `"${title}"` : "Your workforce requirement"} closes {date ? `on ${date}` : "soon"}. After that, partners can no
          longer respond to it, and it cannot be reopened.
        </Paragraph>
        <Paragraph>If you still need workers, extend it on its page before then.</Paragraph>
        {slug && id && /^[0-9a-f-]{36}$/.test(id) ? (
          <Action href={url(siteUrl, `/org/${slug}/requirements/${id}`)}>Extend the requirement</Action>
        ) : null}
      </Layout>
    );
  },
};
