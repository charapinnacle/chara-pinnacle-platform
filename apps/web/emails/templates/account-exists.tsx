import { Action, Layout, Paragraph } from "../layout.tsx";
import { url } from "../payload.ts";
import type { Template } from "../template.ts";
import { BRAND_NAME } from "../../lib/brand.ts";

// Sent when somebody signs up with the address of a confirmed account: the sign-up page says the same for every address, so
// the owner learns here, and only here, that the address is already registered (D89).
export const accountExists: Template = {
  subject: () => `You already have a ${BRAND_NAME} account`,
  Body: ({ siteUrl }) => (
    <Layout preview="Someone tried to create an account with this address" heading={`You already have a ${BRAND_NAME} account`}>
      <Paragraph>
        Someone tried to create a new {BRAND_NAME} account with this email address, but it already belongs to an account. No new
        account was created and nothing in your account was changed.
      </Paragraph>
      <Action href={url(siteUrl, "/login")}>Log in</Action>
      <Paragraph>
        Forgot your password? <a href={url(siteUrl, "/forgot-password")}>Reset your password</a>. If you sign in with Google, use
        Continue with Google instead. If it was not you, you can ignore this email.
      </Paragraph>
    </Layout>
  ),
};
