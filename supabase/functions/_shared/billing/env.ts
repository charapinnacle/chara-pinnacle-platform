import type { BillingProvider } from "./provider.ts";
import { nullProvider } from "./providers/null.ts";
import { stripeProvider } from "./providers/stripe.ts";

// There is no default provider: a deployment that forgot the setting must fail, not quietly start no checkout. The
// function that verifies deliveries (webhook) also needs the signing secret, or it would accept what it cannot verify.
export function billingProviderFromEnv(
  env: { get(name: string): string | undefined },
  options: { webhook?: boolean } = {},
): BillingProvider {
  const siteUrl = env.get("SITE_URL");
  if (!siteUrl) {
    throw new Error("SITE_URL is required");
  }
  const name = env.get("BILLING_PROVIDER");
  if (name === "stripe") {
    const secretKey = env.get("STRIPE_SECRET_KEY");
    const webhookSecret = env.get("STRIPE_WEBHOOK_SECRET");
    if (!secretKey || (options.webhook && !webhookSecret)) {
      throw new Error(
        "STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET for the webhook) are required when BILLING_PROVIDER is stripe",
      );
    }
    return stripeProvider({ secretKey, siteUrl, webhookSecret });
  }
  if (name === "null") {
    const webhookSecret = env.get("BILLING_WEBHOOK_SECRET");
    if (options.webhook && !webhookSecret) {
      throw new Error("BILLING_WEBHOOK_SECRET is required when BILLING_PROVIDER is null");
    }
    return nullProvider(siteUrl, webhookSecret);
  }
  throw new Error("BILLING_PROVIDER must be stripe or null");
}
