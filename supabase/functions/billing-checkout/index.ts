import { serviceClient, userClient } from "../_shared/supabase.ts";
import { billingProviderFromEnv } from "../_shared/billing/env.ts";
import { handleBillingCheckout } from "./handler.ts";

const siteUrl = Deno.env.get("SITE_URL");
if (!siteUrl) {
  throw new Error("SITE_URL is required");
}

const deps = {
  userClient: (authorization: string) => userClient(Deno.env, authorization),
  serviceClient: serviceClient(Deno.env),
  provider: billingProviderFromEnv(Deno.env),
  siteUrl,
  portalConfigurations: {
    employer: Deno.env.get("STRIPE_PORTAL_CONFIGURATION_EMPLOYER") || undefined,
    recruitment_company: Deno.env.get("STRIPE_PORTAL_CONFIGURATION_RECRUITMENT_COMPANY") || undefined,
    staffing_company: Deno.env.get("STRIPE_PORTAL_CONFIGURATION_STAFFING_COMPANY") || undefined,
  },
};

Deno.serve((req) => handleBillingCheckout(req, deps));
