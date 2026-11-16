import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url, type Payload } from "../payload.ts";
import type { Template } from "../template.ts";

const LABELS: Record<string, string> = {
  shortlisted: "Shortlisted",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Not selected",
  withdrawn: "Withdrawn",
};

function title(payload: Payload): string {
  return field(payload, "job_title") ?? "your application";
}

// A submitted candidate's stage (FR-O5 AC9) carries submission_id and the partner's name instead of an application: the
// email names the partner that proposed the candidate and links the submission's page. Never the employer's note.
function SubmissionBody({ payload, siteUrl }: Parameters<Template["Body"]>[0]) {
  const status = field(payload, "status");
  const label = status ? LABELS[status] : undefined;
  const org = field(payload, "org_name");
  const position = org ? `${title(payload)} at ${org}` : title(payload);
  const partner = field(payload, "partner_name") ?? "a recruitment company";
  const id = field(payload, "submission_id");
  return (
    <Layout preview={label ? `Your submission is now ${label}` : "Your submission was updated"} heading="Your submission was updated">
      <Paragraph>
        {label
          ? `Your submission by ${partner} for ${position} is now: ${label}.`
          : `There is an update on your submission by ${partner} for ${position}.`}
      </Paragraph>
      <Paragraph>The details are in your journey tracker.</Paragraph>
      {id ? <Action href={url(siteUrl, `/submissions/${id}`)}>View your submission</Action> : null}
    </Layout>
  );
}

export const statusChanged: Template = {
  subject: (payload) =>
    field(payload, "submission_id") ? `Update on your submission for ${title(payload)}` : `Update on your application for ${title(payload)}`,
  Body: ({ payload, siteUrl }) => {
    if (field(payload, "submission_id")) return <SubmissionBody payload={payload} siteUrl={siteUrl} />;
    const status = field(payload, "status");
    const label = status ? LABELS[status] : undefined;
    const org = field(payload, "org_name");
    const position = org ? `${title(payload)} at ${org}` : title(payload);
    const id = field(payload, "application_id");
    return (
      <Layout preview={label ? `Your application is now ${label}` : "Your application was updated"} heading="Your application was updated">
        <Paragraph>
          {status === "withdrawn"
            ? `You withdrew your application for ${position}.`
            : label
              ? `Your application for ${position} is now: ${label}.`
              : `There is an update on your application for ${position}.`}
        </Paragraph>
        <Paragraph>The details are in your journey tracker.</Paragraph>
        {id ? <Action href={url(siteUrl, `/applications/${id}`)}>View your application</Action> : null}
      </Layout>
    );
  },
};
