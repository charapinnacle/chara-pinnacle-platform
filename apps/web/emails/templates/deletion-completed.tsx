import { Layout, Paragraph } from "../layout.tsx";
import type { Template } from "../template.ts";

export const deletionCompleted: Template = {
  subject: () => "Your CHARA account was deleted",
  Body: () => (
    <Layout preview="Your account was deleted" heading="Your account was deleted">
      <Paragraph>As you asked, your account and the personal data in it were erased. Thank you for using CHARA.</Paragraph>
    </Layout>
  ),
};
