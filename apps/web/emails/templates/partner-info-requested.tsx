import { Action, Layout, Paragraph, Quote } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

// The steps staff may reopen (organizations.info_step), as the onboarding page names and addresses them; the licences are
// kept on the workforce profile.
const STEPS: Record<string, { label: string; path: (slug: string | undefined) => string }> = {
  company: { label: "your company details", path: () => "/onboarding?step=company" },
  where_you_serve: { label: "where you serve and what you offer", path: () => "/onboarding?step=where-you-serve" },
  commitments: { label: "the employer-pays commitment", path: () => "/onboarding?step=commitments" },
  licences: {
    label: "your licences",
    path: (slug) => (slug ? `/org/${encodeURIComponent(slug)}/workforce-profile#licences-heading` : "/onboarding"),
  },
};

export const partnerInfoRequested: Template = {
  subject: (payload) => `Our team needs more information about ${field(payload, "org_name") ?? "your company"}`,
  Body: ({ payload, siteUrl }) => {
    const org = field(payload, "org_name") ?? "your company";
    const step = STEPS[field(payload, "info_step") ?? ""];
    const reason = field(payload, "reason");
    const slug = field(payload, "org_slug");
    return (
      <Layout preview={`More information is needed about ${org}`} heading="Our team needs more information">
        <Paragraph>
          Our team reviewed {org} and needs more information{step ? ` about ${step.label}` : ""} before it can be listed.
          {reason ? " Their message:" : ""}
        </Paragraph>
        {reason ? <Quote>{reason}</Quote> : null}
        <Paragraph>Update the step, then submit your company again from the Ready step.</Paragraph>
        <Action href={url(siteUrl, step ? step.path(slug) : "/onboarding")}>Update your company</Action>
      </Layout>
    );
  },
};
