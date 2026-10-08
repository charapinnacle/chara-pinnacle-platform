import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, humanize, url } from "../payload.ts";
import type { Template } from "../template.ts";

// Amounts are stored in the minor unit of the currency (ISO 4217).
function price(amountMinor: string | undefined, currency: string | undefined): string | undefined {
  const minor = Number(amountMinor);
  if (!amountMinor || !Number.isFinite(minor) || !currency || !/^[A-Z]{3}$/.test(currency)) {
    return undefined;
  }
  const formatter = new Intl.NumberFormat("en", { style: "currency", currency });
  return formatter.format(minor / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2));
}

export const trialEnding: Template = {
  subject: (payload) => `Your CHARA trial ends on ${field(payload, "trial_ends_at") ?? "soon"}`,
  Body: ({ payload, siteUrl }) => {
    const ends = field(payload, "trial_ends_at");
    const plan = field(payload, "plan_code");
    const amount = price(field(payload, "amount_minor"), field(payload, "currency"));
    const slug = field(payload, "org_slug");
    return (
      <Layout preview={ends ? `Your trial ends on ${ends}` : "Your trial is ending"} heading="Your trial is ending">
        <Paragraph>
          Your free trial{plan ? ` of the ${humanize(plan)} plan` : ""} ends on {ends ?? "the date shown in your billing page"}.
          {amount ? ` After that the plan costs ${amount} per billing period, charged to your payment method.` : ""}
        </Paragraph>
        <Paragraph>Check your plan and payment method before then to keep your vacancies and limits.</Paragraph>
        {slug ? <Action href={url(siteUrl, `/org/${slug}/billing`)}>Open billing</Action> : null}
      </Layout>
    );
  },
};
