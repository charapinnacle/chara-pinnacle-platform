import { Link } from "@react-email/components";
import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

// FR-N2 step Withdraw (AC8): a recruitment or staffing company withdrew its response to the recipient's workforce
// requirement. The payload holds the response and requirement ids, the requirement's title, the partner's display name
// and the slug of the recipient's own company; never the reason, which the responses page shows.
export const responseWithdrawn: Template = {
  subject: (payload) => {
    const title = field(payload, "title");
    return title ? `Response withdrawn: ${title}` : "A partner withdrew its response to your workforce requirement";
  },
  Body: ({ payload, siteUrl }) => {
    const title = field(payload, "title");
    const partner = field(payload, "partner_name");
    const slug = field(payload, "org_slug");
    const id = field(payload, "requirement_id");
    return (
      <Layout preview="A partner withdrew its response" heading="A response was withdrawn">
        <Paragraph>
          {partner ?? "A partner"} withdrew its response to {title ? `"${title}"` : "your workforce requirement"}. You no longer
          need to decide on it.
        </Paragraph>
        {slug && id && /^[0-9a-f-]{36}$/.test(id) ? (
          <Action href={url(siteUrl, `/org/${slug}/requirements/${id}/responses`)}>See the responses</Action>
        ) : null}
        <Paragraph>
          You can turn these emails off in your <Link href={url(siteUrl, "/settings/notifications")}>notification settings</Link>.
        </Paragraph>
      </Layout>
    );
  },
};
