import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSharedSecret } from "../_shared/auth.ts";
import { json } from "../_shared/http.ts";
import type { Archive } from "./archive.ts";

const PAGE_SIZE = 1000;
const MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const encoder = new TextEncoder();

interface AuditExportDeps {
  client: SupabaseClient;
  sharedSecret: string;
  archive: Archive;
  now: () => Date;
  alert: (alert: string, detail: Record<string, unknown>) => void;
}

interface ExportedRow {
  id: number;
  created_at: string;
}

// The month before the one `now` is in, in UTC: the scheduler calls on the first of the month.
export function previousMonth(now: Date): string {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return first.toISOString().slice(0, 7);
}

// The scheduler sends no month; a person who re-runs an export names one.
async function requestedMonth(req: Request): Promise<string | null | undefined> {
  const text = await req.text();
  if (text.trim() === "") {
    return null;
  }
  try {
    const { month } = JSON.parse(text) as { month?: unknown };
    if (month === undefined) {
      return null;
    }
    return typeof month === "string" && MONTH.test(month) ? month : undefined;
  } catch {
    return undefined;
  }
}

// Pages of (created_at, id) until one is short. Each page is encoded as it arrives and the file is joined once, so the
// peak is about twice the file (the pages and the file), not the lines, the joined text and the bytes at once.
async function exportedFile(
  client: SupabaseClient,
  month: string,
): Promise<{ file: Uint8Array<ArrayBuffer>; rows: number }> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  let rows = 0;
  let after: ExportedRow | null = null;
  for (;;) {
    const { data, error } = await client.rpc("audit_export_month", {
      p_month: month,
      p_after_at: after?.created_at,
      p_after_id: after?.id,
      p_limit: PAGE_SIZE,
    });
    if (error) {
      throw error;
    }
    const page = data as ExportedRow[];
    const chunk = encoder.encode(page.map((row) => `${JSON.stringify(row)}\n`).join(""));
    chunks.push(chunk);
    size += chunk.length;
    rows += page.length;
    if (page.length < PAGE_SIZE) {
      break;
    }
    after = page[page.length - 1];
  }
  const file = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks.splice(0)) {
    file.set(chunk, offset);
    offset += chunk.length;
  }
  return { file, rows };
}

function describe(error: unknown): Record<string, unknown> {
  const { status, code } = (typeof error === "object" && error !== null ? error : {}) as {
    status?: unknown;
    code?: unknown;
  };
  const bounded = (value: unknown) => (typeof value === "string" || typeof value === "number" ? value : undefined);
  return { status: bounded(status), code: bounded(code) };
}

// One file of the month and, written last, its manifest (month, rows, SHA-256): a month with a manifest is complete. The
// archive never overwrites, so running the same month again after a success changes nothing, and after a failure between
// the two objects writes the manifest that is missing. When the file was already there the manifest describes the table
// as it is now, which differs from the stored file if an erasure ran in between: it is marked `resumed` and the alert
// `audit_export_resumed` asks a person to compare its SHA-256 with the checksum the store holds for the file. A failure
// raises the alert operations watch for and answers 500; the retry is the second scheduled call of the day or a manual
// call with the month (docs/runbooks/audit-log.md section 5).
export async function handleAuditExport(req: Request, deps: AuditExportDeps): Promise<Response> {
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }
  if (!hasSharedSecret(req, deps.sharedSecret)) {
    return json(401, { error: "unauthorized" });
  }
  const requested = await requestedMonth(req);
  if (requested === undefined) {
    return json(400, { error: "invalid_month" });
  }
  const month = requested ?? previousMonth(deps.now());
  const fileKey = `audit-log/${month.slice(0, 4)}/${month}.ndjson`;
  try {
    const { file, rows } = await exportedFile(deps.client, month);
    const { data: counted, error } = await deps.client.rpc("audit_export_count", { p_month: month });
    if (error) {
      throw error;
    }
    if (Number(counted) !== rows) {
      deps.alert("audit_export_count_mismatch", { month, exported: rows, counted: Number(counted) });
      return json(500, { error: "export_failed" });
    }
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", file))].map((b) =>
      b.toString(16).padStart(2, "0")
    ).join("");
    const wroteFile = await deps.archive.put(fileKey, file, "application/x-ndjson");
    const manifest = encoder.encode(
      `${JSON.stringify({ month, rows, sha256, file: fileKey, ...(wroteFile ? {} : { resumed: true }) })}\n`,
    );
    const wroteManifest = await deps.archive.put(
      `${fileKey.slice(0, -".ndjson".length)}.manifest.json`,
      manifest,
      "application/json",
    );
    if (!wroteFile && wroteManifest) {
      deps.alert("audit_export_resumed", { month });
    }
    return json(200, {
      month,
      rows,
      sha256,
      status: wroteFile || wroteManifest ? "archived" : "already_archived",
    });
  } catch (e) {
    deps.alert("audit_export_failed", { month, ...describe(e) });
    return json(500, { error: "export_failed" });
  }
}
