import { Action, Layout, Paragraph } from "../layout.tsx";
import { url } from "../payload.ts";
import type { Template } from "../template.ts";

export const mfaReset: Template = {
  subject: () => "Two-step verification was reset on your CHARA account",
  Body: ({ siteUrl }) => (
    <Layout preview="Two-step verification was reset" heading="Two-step verification was reset">
      <Paragraph>
        Our support team reset two-step verification on your account and signed you out everywhere. Sign in again and set it up
        again. If you did not ask for this, reply to this email or contact support at once.
      </Paragraph>
      <Action href={url(siteUrl, "/login")}>Sign in</Action>
    </Layout>
  ),
};
