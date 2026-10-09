import { userClient } from "../_shared/supabase.ts";
import { billingProviderFromEnv } from "../_shared/billing/env.ts";
import { handleBillingCheckout } from "./handler.ts";

const siteUrl = Deno.env.get("SITE_URL");
if (!siteUrl) {
  throw new Error("SITE_URL is required");
}

const deps = {
  userClient: (authorization: string) => userClient(Deno.env, authorization),
  provider: billingProviderFromEnv(Deno.env),
  siteUrl,
};

Deno.serve((req) => handleBillingCheckout(req, deps));
