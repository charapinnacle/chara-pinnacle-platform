import { json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { archiveFromEnv } from "./archive.ts";
import { handleAuditExport } from "./handler.ts";

// Operations watch the function logs for the key "alert"; the rule is configured in the log platform.
const alert = (name: string, detail: Record<string, unknown>) =>
  console.error(JSON.stringify({ alert: name, ...detail }));

// Built for each request, not at load: a function that cannot start would raise no alert, one that answers can.
Deno.serve((req) => {
  let deps: Parameters<typeof handleAuditExport>[1];
  try {
    deps = {
      client: serviceClient(Deno.env),
      sharedSecret: Deno.env.get("EDGE_SHARED_SECRET") ?? "",
      archive: archiveFromEnv(Deno.env),
      now: () => new Date(),
      alert,
    };
  } catch {
    alert("audit_export_misconfigured", {});
    return Promise.resolve(json(500, { error: "misconfigured" }));
  }
  return handleAuditExport(req, deps);
});
