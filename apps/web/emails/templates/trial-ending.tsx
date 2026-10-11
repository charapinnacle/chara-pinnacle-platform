import { Action, Layout, Paragraph } from "../layout.tsx";
import { field, humanize, url } from "../payload.ts";
import type { Template } from "../template.ts";

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });

// The UTC date of an ISO timestamp, as 10 November 2026; undefined when the value is missing or not a date.
function longDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(Date.parse(value))) {
    return undefined;
  }
  return dateFormat.format(new Date(value));
}

// Amounts are stored in the minor unit of the currency (ISO 4217).
function price(amountMinor: string | undefined, currency: string | undefined): string | undefined {
  const minor = Number(amountMinor);
  if (!amountMinor || !Number.isFinite(minor) || !currency || !/^[A-Z]{3}$/.test(currency)) {
    return undefined;
  }
  const formatter = new Intl.NumberFormat("en", { style: "currency", currency });
  return formatter.format(minor / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2));
}

// The payload carries no interval because billing.plans allows only "month".
export const trialEnding: Template = {
  subject: (payload) => `Your CHARA trial ends on ${longDate(field(payload, "trial_ends_at")) ?? "soon"}`,
  Body: ({ payload, siteUrl }) => {
    const ends = longDate(field(payload, "trial_ends_at"));
    const code = field(payload, "plan_code");
    const plan = field(payload, "plan_name") ?? (code ? humanize(code) : undefined);
    const amount = price(field(payload, "amount_minor"), field(payload, "currency"));
    const slug = field(payload, "org_slug");
    return (
      <Layout preview={ends ? `Your trial ends on ${ends}` : "Your trial is ending"} heading="Your trial is ending">
        <Paragraph>
          Your free trial{plan ? ` of the ${plan} plan` : ""} ends on {ends ?? "the date shown in your billing page"}.
          {amount ? ` After that the plan costs ${amount} per month, excluding VAT, charged to your payment method.` : ""}
        </Paragraph>
        <Paragraph>Check your plan and payment method before then to keep your vacancies and limits.</Paragraph>
        {slug ? <Action href={url(siteUrl, `/org/${slug}/billing`)}>Open billing</Action> : null}
      </Layout>
    );
  },
};
