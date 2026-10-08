import { serviceClient } from "../_shared/supabase.ts";
import { handleNotify } from "./handler.ts";
import { nullProvider, type Provider, resendProvider } from "./providers.ts";

// There is no default provider: a deployment that forgot the setting must fail, not quietly send nothing.
function provider(): Provider {
  const name = Deno.env.get("EMAIL_PROVIDER");
  if (name === "resend") {
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) {
      throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER is resend");
    }
    return resendProvider(key);
  }
  if (name === "null") {
    return nullProvider(Deno.env.get("MAIL_CATCHER_URL"));
  }
  throw new Error("EMAIL_PROVIDER must be resend or null");
}

const from = Deno.env.get("EMAIL_FROM");
const siteUrl = Deno.env.get("SITE_URL");
if (!from || !siteUrl) {
  throw new Error("EMAIL_FROM and SITE_URL are required");
}

const deps = {
  client: serviceClient(Deno.env),
  provider: provider(),
  from,
  siteUrl,
  sharedSecret: Deno.env.get("EDGE_SHARED_SECRET") ?? "",
  webhookSecret: Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "",
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  // Operations watch the function logs for the key "alert"; the rule is configured in the log platform.
  alert: (alert: string, detail: Record<string, unknown>) => console.error(JSON.stringify({ alert, ...detail })),
};

Deno.serve((req) => handleNotify(req, deps));
