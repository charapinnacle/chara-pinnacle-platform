import { Action, Layout, Paragraph, Quote } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

export const vacancyHidden: Template = {
  subject: (payload) => `Your vacancy "${field(payload, "job_title") ?? "vacancy"}" was hidden`,
  Body: ({ payload, siteUrl }) => {
    const title = field(payload, "job_title") ?? "your vacancy";
    const reasons = field(payload, "reasons");
    const slug = field(payload, "org_slug");
    const id = field(payload, "job_id");
    return (
      <Layout preview={`${title} was hidden by moderation`} heading="A vacancy was hidden">
        <Paragraph>Our moderators hid the vacancy {title}. It is no longer shown to candidates. The reasons:</Paragraph>
        {reasons ? <Quote>{reasons}</Quote> : null}
        <Paragraph>
          If you think this was a mistake, you can appeal. The route is described on the Complaints and Dispute Process page.
        </Paragraph>
        <Action href={url(siteUrl, "/legal/complaints-and-dispute-process")}>How to appeal</Action>
        {slug && id ? (
          <Paragraph>
            <a href={url(siteUrl, `/org/${slug}/jobs/${id}`)}>Open the vacancy</a>
          </Paragraph>
        ) : null}
      </Layout>
    );
  },
};
