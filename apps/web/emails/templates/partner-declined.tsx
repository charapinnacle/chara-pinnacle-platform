import { Action, Layout, Paragraph, Quote } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

// The dashboard address redirects a company to its own segment; the slug picks this company for a member of several.
const dashboard = (slug: string | undefined) => (slug ? `/dashboard/employer?org=${encodeURIComponent(slug)}` : "/dashboard/employer");

export const partnerDeclined: Template = {
  subject: (payload) => `${field(payload, "org_name") ?? "Your company"} was not listed`,
  Body: ({ payload, siteUrl }) => {
    const org = field(payload, "org_name") ?? "your company";
    const reason = field(payload, "reason");
    return (
      <Layout preview={`Our team decided not to list ${org}`} heading="Your company was not listed">
        <Paragraph>
          Our team reviewed {org} and decided not to list it in the partner directories.{reason ? " The reason:" : ""}
        </Paragraph>
        {reason ? <Quote>{reason}</Quote> : null}
        <Paragraph>
          If you think this was a mistake, you can appeal. The route is described on the Complaints and Dispute Process page.
        </Paragraph>
        <Action href={url(siteUrl, dashboard(field(payload, "org_slug")))}>Open your dashboard</Action>
      </Layout>
    );
  },
};
