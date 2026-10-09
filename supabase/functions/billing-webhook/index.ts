import { serviceClient } from "../_shared/supabase.ts";
import { billingProviderFromEnv } from "../_shared/billing/env.ts";
import { handleBillingWebhook } from "./handler.ts";

const deps = {
  client: serviceClient(Deno.env),
  provider: billingProviderFromEnv(Deno.env, { webhook: true }),
  now: Date.now,
  log: (entry: Record<string, unknown>) => console.error(JSON.stringify(entry)),
};

Deno.serve((req) => handleBillingWebhook(req, deps));
