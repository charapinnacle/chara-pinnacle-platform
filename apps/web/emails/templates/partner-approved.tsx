import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";
import { BRAND_NAME } from "../../lib/brand.ts";

// Listed, never "approved" or "verified" (decision 2.6): the review is not a verification.
export const partnerApproved: Template = {
  subject: (payload) => {
    const org = field(payload, "org_name");
    return org ? `${org} is now listed on ${BRAND_NAME}` : `Your company is now listed on ${BRAND_NAME}`;
  },
  Body: ({ siteUrl, payload }) => {
    const org = field(payload, "org_name") ?? "your company";
    return (
      <Layout preview={`Our team listed ${org}`} heading="Your company is listed">
        <Paragraph>Our team reviewed {org} and listed it in the partner directories, where employers can now find it.</Paragraph>
        <Paragraph>Keep your workforce profile and availability up to date so that employers see what you offer today.</Paragraph>
        <Action href={url(siteUrl, "/dashboard/employer")}>Open your dashboard</Action>
      </Layout>
    );
  },
};
