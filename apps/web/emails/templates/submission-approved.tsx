import { Link } from "@react-email/components";
import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

// FR-O4 step Approve (AC5), to the owners and admins of the partner and of the employer: a candidate approved the
// submission. The payload holds the submission and requirement ids, the requirement as the recipient knows it, the
// partner's name, to_partner for the partner's own owners and admins (who read "a candidate you proposed") and the
// recipient's own slug; never the candidate, the address or the documents.
export const submissionApproved: Template = {
  subject: (payload) => {
    const title = field(payload, "title");
    return title ? `Candidate submitted: ${title}` : "A candidate approved a submission";
  },
  Body: ({ payload, siteUrl }) => {
    const title = field(payload, "title");
    const partner = field(payload, "partner_name");
    const slug = field(payload, "org_slug");
    const id = field(payload, "requirement_id");
    return (
      <Layout preview="A candidate approved a submission" heading="A candidate was submitted">
        <Paragraph>
          {payload.to_partner === true ? "A candidate you proposed" : `A candidate proposed by ${partner ?? "a partner"}`} approved
          the submission for {title ? `"${title}"` : "a workforce requirement"}.
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
