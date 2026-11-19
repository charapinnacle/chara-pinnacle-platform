import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, longDate, url } from "../payload.ts";
import type { Template } from "../template.ts";
import { BRAND_NAME } from "../../lib/brand.ts";

// The link leads to the export page, where a short-lived download link is made for the signed-in owner (FR-S3 AC8): the
// email itself never carries a link to the file.
export const dataExportReady: Template = {
  subject: () => `Your ${BRAND_NAME} data is ready to download`,
  Body: ({ payload, siteUrl }) => {
    const until = longDate(field(payload, "expires_at"));
    return (
      <Layout preview="Your copy of your data is ready" heading="Your data is ready">
        <Paragraph>
          The copy of your data that you asked for is ready. Sign in to download it{until ? ` until ${until}` : ""}. After that it is
          deleted and you can ask for a new copy.
        </Paragraph>
        <Paragraph>If you did not ask for a copy of your data, change your password and contact us.</Paragraph>
        <Action href={url(siteUrl, "/settings/data-export")}>Download your data</Action>
      </Layout>
    );
  },
};
