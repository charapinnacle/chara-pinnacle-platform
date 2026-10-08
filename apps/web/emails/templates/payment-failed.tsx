import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, url } from "../payload.ts";
import type { Template } from "../template.ts";

export const paymentFailed: Template = {
  subject: () => "We could not collect your CHARA payment",
  Body: ({ payload, siteUrl }) => {
    const slug = field(payload, "org_slug");
    return (
      <Layout preview="Your last payment failed" heading="Your payment failed">
        <Paragraph>
          We could not collect your last payment. Your plan stays active for a short grace period. Update your payment method to avoid
          losing it.
        </Paragraph>
        {slug ? <Action href={url(siteUrl, `/org/${slug}/billing`)}>Update payment method</Action> : null}
      </Layout>
    );
  },
};
