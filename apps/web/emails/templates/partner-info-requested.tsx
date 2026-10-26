import { Action, Layout, Paragraph, Quote } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

// The steps staff may reopen (organizations.info_step), as the onboarding page names and addresses them.
const STEPS: Record<string, { label: string; query: string }> = {
  company: { label: "your company details", query: "company" },
  where_you_serve: { label: "where you serve and what you offer", query: "where-you-serve" },
  commitments: { label: "the employer-pays commitment", query: "commitments" },
};

export const partnerInfoRequested: Template = {
  subject: (payload) => `Our team needs more information about ${field(payload, "org_name") ?? "your company"}`,
  Body: ({ payload, siteUrl }) => {
    const org = field(payload, "org_name") ?? "your company";
    const step = STEPS[field(payload, "info_step") ?? ""];
    const reason = field(payload, "reason");
    return (
      <Layout preview={`More information is needed about ${org}`} heading="Our team needs more information">
        <Paragraph>
          Our team reviewed {org} and needs more information{step ? ` about ${step.label}` : ""} before it can be listed.
          {reason ? " Their message:" : ""}
        </Paragraph>
        {reason ? <Quote>{reason}</Quote> : null}
        <Paragraph>Update the step, then submit your company again from the Ready step.</Paragraph>
        <Action href={url(siteUrl, step ? `/onboarding?step=${step.query}` : "/onboarding")}>Update your company</Action>
      </Layout>
    );
  },
};
