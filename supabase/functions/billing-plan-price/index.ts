import { userClient } from "../_shared/supabase.ts";
import { billingProviderFromEnv } from "../_shared/billing/env.ts";
import { handleBillingPlanPrice } from "./handler.ts";

const deps = {
  userClient: (authorization: string) => userClient(Deno.env, authorization),
  provider: billingProviderFromEnv(Deno.env),
};

Deno.serve((req) => handleBillingPlanPrice(req, deps));
