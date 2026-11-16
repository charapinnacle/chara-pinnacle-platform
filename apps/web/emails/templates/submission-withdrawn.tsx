import { Link } from "@react-email/components";
import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

// FR-O4 step Withdraw (AC9), to the owners and admins of the partner and of the employer: a candidate withdrew a
// submission, and the documents shared with it can no longer be opened. The payload is that of submission_approved.
export const submissionWithdrawn: Template = {
  subject: (payload) => {
    const title = field(payload, "title");
    return title ? `Candidate withdrawn: ${title}` : "A candidate withdrew a submission";
  },
  Body: ({ payload, siteUrl }) => {
    const title = field(payload, "title");
    const partner = field(payload, "partner_name");
    const slug = field(payload, "org_slug");
    const id = field(payload, "requirement_id");
    return (
      <Layout preview="A candidate withdrew a submission" heading="A candidate withdrew">
        <Paragraph>
          A candidate proposed by {partner ?? "a partner"} withdrew from {title ? `"${title}"` : "a workforce requirement"}. The
          documents the candidate shared can no longer be opened.
        </Paragraph>
        {slug && id && /^[0-9a-f-]{36}$/.test(id) ? (
          <Action href={url(siteUrl, `/org/${slug}/requirements/${id}/submissions`)}>See the candidates</Action>
        ) : null}
        <Paragraph>
          You can turn these emails off in your <Link href={url(siteUrl, "/settings/notifications")}>notification settings</Link>.
        </Paragraph>
      </Layout>
    );
  },
};
