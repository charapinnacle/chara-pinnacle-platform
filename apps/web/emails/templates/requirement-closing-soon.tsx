import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, longDate, url } from "../payload.ts";
import type { Template } from "../template.ts";

// FR-M2 step Expire: the employer's owners and admins are told before an open or paused requirement closes, with the way
// to extend it; the partners with a live invitation are told too (V43), with a link to their invitation. The payload holds
// the requirement id, its title, the closing date and the slug of the recipient's company, and a partner's the
// invitation id; never the employer's name.
export const requirementClosingSoon: Template = {
  subject: (payload) => {
    const title = field(payload, "title");
    const date = longDate(field(payload, "closes_on"));
    const fallback = field(payload, "invitation_id") ? "A workforce requirement you are invited to" : "Your workforce requirement";
    return `${title ? `"${title}"` : fallback} closes ${date ? `on ${date}` : "soon"}`;
  },
  Body: ({ payload, siteUrl }) => {
    const title = field(payload, "title");
    const date = longDate(field(payload, "closes_on"));
    const slug = field(payload, "org_slug");
    const id = field(payload, "requirement_id");
    const invitation = field(payload, "invitation_id");
    if (invitation) {
      return (
        <Layout preview={`A workforce requirement closes ${date ? `on ${date}` : "soon"}`} heading="A workforce requirement closes soon">
          <Paragraph>
            {title ? `"${title}"` : "A workforce requirement your company is invited to"} closes {date ? `on ${date}` : "soon"}, unless
            the employer extends it. After that, partners can no longer respond to it.
          </Paragraph>
          {slug && /^[0-9a-f-]{36}$/.test(invitation) ? (
            <Action href={url(siteUrl, `/org/${slug}/invitations/${invitation}`)}>See the invitation</Action>
          ) : null}
        </Layout>
      );
    }
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
