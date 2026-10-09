import { serviceClient } from "../_shared/supabase.ts";
import type { BillingProvider } from "../_shared/billing/provider.ts";
import { nullProvider } from "../_shared/billing/providers/null.ts";
import { stripeProvider } from "../_shared/billing/providers/stripe.ts";
import { handleBillingWebhook } from "./handler.ts";

const siteUrl = Deno.env.get("SITE_URL");
if (!siteUrl) {
  throw new Error("SITE_URL is required");
}

// There is no default provider, and a provider needs its signing secret: a deployment that forgot either must fail, not
// accept deliveries it cannot verify.
function provider(site: string): BillingProvider {
  const name = Deno.env.get("BILLING_PROVIDER");
  if (name === "stripe") {
    const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!secretKey || !webhookSecret) {
      throw new Error("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required when BILLING_PROVIDER is stripe");
    }
    return stripeProvider({ secretKey, siteUrl: site, webhookSecret });
  }
  if (name === "null") {
    const webhookSecret = Deno.env.get("BILLING_WEBHOOK_SECRET");
    if (!webhookSecret) {
      throw new Error("BILLING_WEBHOOK_SECRET is required when BILLING_PROVIDER is null");
    }
    return nullProvider(site, webhookSecret);
  }
  throw new Error("BILLING_PROVIDER must be stripe or null");
}

const deps = {
  client: serviceClient(Deno.env),
  provider: provider(siteUrl),
  now: Date.now,
  log: (entry: Record<string, unknown>) => console.error(JSON.stringify(entry)),
};

Deno.serve((req) => handleBillingWebhook(req, deps));
