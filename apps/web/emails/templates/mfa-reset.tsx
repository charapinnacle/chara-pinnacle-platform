import { Action, Layout, Paragraph } from "../layout.tsx";
import { url } from "../payload.ts";
import type { Template } from "../template.ts";

export const mfaReset: Template = {
  subject: () => "Two-step verification was reset on your CHARA account",
  Body: ({ siteUrl }) => (
    <Layout preview="Two-step verification was reset" heading="Two-step verification was reset">
      <Paragraph>
        Our support team removed the two-step verification factors from your CHARA account and signed you out everywhere. The
        next time you sign in you must enrol again before you can use the account. If you did not ask for this, reply to this
        email or contact support at once.
      </Paragraph>
      <Action href={url(siteUrl, "/login")}>Sign in</Action>
    </Layout>
  ),
};
