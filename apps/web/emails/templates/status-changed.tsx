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

export const statusChanged: Template = {
  subject: (payload) => `Update on your application for ${title(payload)}`,
  Body: ({ payload, siteUrl }) => {
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
