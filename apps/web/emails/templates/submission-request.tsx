import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, longDate, url } from "../payload.ts";
import type { Template } from "../template.ts";
import { BRAND_NAME } from "../../lib/brand.ts";

// FR-O4 step Invite (AC1, AC5): a recruitment or staffing company asks the candidate's permission to propose them for a
// workforce requirement. The payload holds the request id, the partner's name, the requirement as the candidate may read
// it (the employer's own title and name only when the employer shows its name, NFR-S11), the destination and the start
// date; never the address or another partner. Mandatory: nothing reaches the employer without the answer.
export const submissionRequest: Template = {
  subject: (payload) => {
    const partner = field(payload, "partner_name");
    return partner ? `${partner} would like to propose you for a job` : "A recruitment company would like to propose you for a job";
  },
  Body: ({ payload, siteUrl }) => {
    const partner = field(payload, "partner_name") ?? "A recruitment company";
    const title = field(payload, "title");
    const country = field(payload, "country_name");
    const employer = field(payload, "employer_name");
    const start = longDate(field(payload, "start_date"));
    const id = field(payload, "submission_id");
    const job = [title ? `"${title}"` : "a job", employer ? `at ${employer}` : null, country ? `in ${country}` : null]
      .filter(Boolean)
      .join(" ");
    return (
      <Layout preview={`${partner} asks to propose you for a job`} heading="A request to propose you for a job">
        <Paragraph>
          {partner} would like to submit you as a candidate for {job}
          {start ? `, starting on ${start}` : ""}.
        </Paragraph>
        <Paragraph>
          Nothing is shared with the employer until you approve the request and choose which documents to share. You can also
          decline it.
        </Paragraph>
        <Paragraph>Workers never pay fees to get a job through {BRAND_NAME}.</Paragraph>
        {id && /^[0-9a-f-]{36}$/.test(id) ? <Action href={url(siteUrl, `/submissions/${id}`)}>See the request</Action> : null}
      </Layout>
    );
  },
};
