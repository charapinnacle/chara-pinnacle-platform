import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

export const applicationReceived: Template = {
  subject: (payload) => `New application for ${field(payload, "job_title") ?? "your vacancy"}`,
  Body: ({ payload, siteUrl }) => {
    const title = field(payload, "job_title") ?? "your vacancy";
    const slug = field(payload, "org_slug");
    return (
      <Layout preview={`A candidate applied for ${title}`} heading="You have a new application">
        <Paragraph>A candidate applied for {title}. Open the applicants list to review the application.</Paragraph>
        {slug ? <Action href={url(siteUrl, `/org/${slug}/applicants`)}>Review applicants</Action> : null}
      </Layout>
    );
  },
};
