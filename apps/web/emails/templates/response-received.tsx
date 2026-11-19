import { Link } from "@react-email/components";
import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

// FR-O2 step Submit (FR-T1 AC1, AC2, AC8): a recruitment or staffing company responded to the recipient's workforce
// requirement. The payload holds the response and requirement ids, the requirement's title, the partner's display name
// and the slug of the recipient's own company; never the proposal, its fee or a document.
export const responseReceived: Template = {
  subject: (payload) => {
    const title = field(payload, "title");
    return title ? `New response to ${title}` : "A partner responded to your workforce requirement";
  },
  Body: ({ payload, siteUrl }) => {
    const title = field(payload, "title");
    const partner = field(payload, "partner_name");
    const slug = field(payload, "org_slug");
    const id = field(payload, "requirement_id");
    return (
      <Layout preview="A partner responded to your workforce requirement" heading="New response to your workforce requirement">
        <Paragraph>
          {partner ?? "A partner"} responded to {title ? `"${title}"` : "your workforce requirement"}.
        </Paragraph>
        {slug && id && /^[0-9a-f-]{36}$/.test(id) ? (
          <Action href={url(siteUrl, `/org/${slug}/requirements/${id}/responses`)}>See the responses</Action>
        ) : null}
        <Paragraph>
          Chara Pinnacle is not a party to any agreement or payment between you and the partner. You can turn these emails off
          in your <Link href={url(siteUrl, "/settings/notifications")}>notification settings</Link>.
        </Paragraph>
      </Layout>
    );
  },
};
