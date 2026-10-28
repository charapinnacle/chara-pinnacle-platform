import { Link } from "@react-email/components";
import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

// FR-N1 step Alert: a new job order that the recipient's company sees in full, sent to owners and admins who switched the
// alert on. The payload holds the requirement id, the generated title, the destination and the slug of the recipient's
// own company; never the employer (NFR-S11), so the email names none, whatever the employer chose to show.
export const jobOrderMatch: Template = {
  subject: (payload) => {
    const title = field(payload, "title");
    return title ? `New job order: ${title}` : "A new job order fits your company";
  },
  Body: ({ payload, siteUrl }) => {
    const title = field(payload, "title");
    const country = field(payload, "country_name");
    const slug = field(payload, "org_slug");
    const id = field(payload, "requirement_id");
    return (
      <Layout preview={title ? `New job order: ${title}` : "A new job order fits your company"} heading="A new job order fits your company">
        <Paragraph>
          {title ? `"${title}"` : "A new job order"} was published{country ? ` for ${country}` : ""}. It fits the countries your
          company serves and the occupations it lists.
        </Paragraph>
        {slug && id && /^[0-9a-f-]{36}$/.test(id) ? (
          <Action href={url(siteUrl, `/org/${slug}/job-orders/${id}`)}>See the job order</Action>
        ) : null}
        <Paragraph>
          You get this email because you switched on new job orders that fit, up to a daily limit. You can turn these emails
          off in your <Link href={url(siteUrl, "/settings/notifications")}>notification settings</Link>.
        </Paragraph>
      </Layout>
    );
  },
};
