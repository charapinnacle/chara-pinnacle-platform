import { json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { stripeProvider } from "../_shared/billing/providers/stripe.ts";
import { nullProvider } from "../_shared/billing/providers/null.ts";
import { handleBillingReconcile } from "./handler.ts";

// Operations watch the function logs for the key "alert"; the rule is configured in the log platform.
const alert = (name: string, detail: Record<string, unknown>) =>
  console.error(JSON.stringify({ alert: name, ...detail }));

// Built for each request, not at load: a function that cannot start would raise no alert, one that answers can.
Deno.serve((req) => {
  let deps: Parameters<typeof handleBillingReconcile>[1];
  try {
    const siteUrl = Deno.env.get("SITE_URL") ?? "";
    const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const name = Deno.env.get("BILLING_PROVIDER");
    if (name !== "stripe" && name !== "null") {
      throw new Error("BILLING_PROVIDER must be stripe or null");
    }
    if (name === "stripe" && !secretKey) {
      throw new Error("STRIPE_SECRET_KEY is required when BILLING_PROVIDER is stripe");
    }
    deps = {
      client: serviceClient(Deno.env),
      provider: name === "stripe" ? stripeProvider({ secretKey: secretKey ?? "", siteUrl }) : nullProvider(siteUrl),
      sharedSecret: Deno.env.get("EDGE_SHARED_SECRET") ?? "",
      alert,
    };
  } catch {
    alert("billing_reconcile_misconfigured", {});
    return Promise.resolve(json(500, { error: "misconfigured" }));
  }
  return handleBillingReconcile(req, deps);
});
