import { serviceClient } from "../_shared/supabase.ts";
import { type Archive, s3Archive } from "./archive.ts";
import { handleAuditExport } from "./handler.ts";

// There is no default archive: a deployment that forgot the setting must fail, not quietly keep the log on the platform.
function archive(): Archive {
  if (Deno.env.get("AUDIT_ARCHIVE_PROVIDER") !== "s3") {
    throw new Error("AUDIT_ARCHIVE_PROVIDER must be s3");
  }
  const endpoint = Deno.env.get("AUDIT_ARCHIVE_ENDPOINT");
  const region = Deno.env.get("AUDIT_ARCHIVE_REGION");
  const bucket = Deno.env.get("AUDIT_ARCHIVE_BUCKET");
  const accessKeyId = Deno.env.get("AUDIT_ARCHIVE_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("AUDIT_ARCHIVE_SECRET_ACCESS_KEY");
  const retainDays = Number(Deno.env.get("AUDIT_ARCHIVE_RETAIN_DAYS"));
  if (
    !endpoint || !region || !bucket || !accessKeyId || !secretAccessKey || !Number.isInteger(retainDays) ||
    retainDays < 2191
  ) {
    throw new Error("The AUDIT_ARCHIVE_* settings are required, with a lock of at least 2191 days (six years)");
  }
  return s3Archive({ endpoint, region, bucket, accessKeyId, secretAccessKey, retainDays });
}

const deps = {
  client: serviceClient(Deno.env),
  sharedSecret: Deno.env.get("EDGE_SHARED_SECRET") ?? "",
  archive: archive(),
  now: () => new Date(),
  // Operations watch the function logs for the key "alert"; the rule is configured in the log platform.
  alert: (alert: string, detail: Record<string, unknown>) => console.error(JSON.stringify({ alert, ...detail })),
};

Deno.serve((req) => handleAuditExport(req, deps));
