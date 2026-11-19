import { userClient } from "../_shared/supabase.ts";
import { billingProviderFromEnv } from "../_shared/billing/env.ts";
import { handleBillingPlanPrice } from "./handler.ts";

const deps = {
  userClient: (authorization: string, requestId?: string) =>
    userClient(Deno.env, authorization, requestId ? { "x-request-id": requestId } : {}),
  provider: billingProviderFromEnv(Deno.env),
};

Deno.serve((req) => handleBillingPlanPrice(req, deps));
