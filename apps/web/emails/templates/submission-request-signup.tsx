import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, longDate, url } from "../payload.ts";
import type { Template } from "../template.ts";
import { BRAND_NAME } from "../../lib/brand.ts";

// FR-O4 step Invite (AC2, AC10): the same request, sent to an address that has no account yet, with an invitation to
// create a worker account (FR-A1). The payload holds the partner's name and the requirement as the candidate may read it,
// and no request id: the request appears on the submissions page once an account with this address is confirmed.
export const submissionRequestSignup: Template = {
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
          To answer, create a free worker account on {BRAND_NAME} with this email address. The request then appears under
          Submissions, where you can approve it and choose which documents to share, or decline it. Nothing is shared with the
          employer until you approve.
        </Paragraph>
        <Paragraph>Workers never pay fees to get a job through {BRAND_NAME}.</Paragraph>
        <Action href={url(siteUrl, "/signup?kind=worker")}>Create your account</Action>
        <Paragraph>If you do not want to be proposed, you can ignore this email. The request expires if you do not answer.</Paragraph>
      </Layout>
    );
  },
};
