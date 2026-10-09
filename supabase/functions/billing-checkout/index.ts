import { serviceClient, userClient } from "../_shared/supabase.ts";
import type { BillingProvider } from "../_shared/billing/provider.ts";
import { nullProvider } from "../_shared/billing/providers/null.ts";
import { stripeProvider } from "../_shared/billing/providers/stripe.ts";
import { handleBillingCheckout } from "./handler.ts";

const siteUrl = Deno.env.get("SITE_URL");
if (!siteUrl) {
  throw new Error("SITE_URL is required");
}

// There is no default provider: a deployment that forgot the setting must fail, not quietly start no checkout.
function provider(site: string): BillingProvider {
  const name = Deno.env.get("BILLING_PROVIDER");
  if (name === "stripe") {
    const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY is required when BILLING_PROVIDER is stripe");
    }
    return stripeProvider({ secretKey, siteUrl: site });
  }
  if (name === "null") {
    return nullProvider(site);
  }
  throw new Error("BILLING_PROVIDER must be stripe or null");
}

const deps = {
  userClient: (authorization: string) => userClient(Deno.env, authorization),
  serviceClient: serviceClient(Deno.env),
  provider: provider(siteUrl),
  siteUrl,
};

Deno.serve((req) => handleBillingCheckout(req, deps));
