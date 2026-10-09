import { json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { billingProviderFromEnv } from "../_shared/billing/env.ts";
import { handleBillingReconcile } from "./handler.ts";

// Operations watch the function logs for the key "alert"; the rule is configured in the log platform.
const alert = (name: string, detail: Record<string, unknown>) =>
  console.error(JSON.stringify({ alert: name, ...detail }));

// Built for each request, not at load: a function that cannot start would raise no alert, one that answers can.
Deno.serve((req) => {
  let deps: Parameters<typeof handleBillingReconcile>[1];
  try {
    deps = {
      client: serviceClient(Deno.env),
      provider: billingProviderFromEnv(Deno.env),
      sharedSecret: Deno.env.get("EDGE_SHARED_SECRET") ?? "",
      alert,
    };
  } catch {
    alert("billing_reconcile_misconfigured", {});
    return Promise.resolve(json(500, { error: "misconfigured" }));
  }
  return handleBillingReconcile(req, deps);
});
