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

// Pages of (created_at, id) until one is short; one object holds the whole month, which is what Phase 1 volumes allow.
async function exportedLines(client: SupabaseClient, month: string): Promise<string[]> {
  const lines: string[] = [];
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
    const rows = data as ExportedRow[];
    for (const row of rows) {
      lines.push(JSON.stringify(row));
    }
    if (rows.length < PAGE_SIZE) {
      return lines;
    }
    after = rows[rows.length - 1];
  }
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
// the two objects writes the one that is missing. A failure raises the alert operations watch for and answers 500; the
// next run of the same month is the retry.
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
    const lines = await exportedLines(deps.client, month);
    const { data: counted, error } = await deps.client.rpc("audit_export_count", { p_month: month });
    if (error) {
      throw error;
    }
    if (Number(counted) !== lines.length) {
      deps.alert("audit_export_count_mismatch", { month, exported: lines.length, counted: Number(counted) });
      return json(500, { error: "export_failed" });
    }
    const file = encoder.encode(lines.map((line) => `${line}\n`).join(""));
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", file))].map((b) =>
      b.toString(16).padStart(2, "0")
    ).join("");
    const manifest = encoder.encode(`${JSON.stringify({ month, rows: lines.length, sha256, file: fileKey })}\n`);
    const wroteFile = await deps.archive.put(fileKey, file, "application/x-ndjson");
    const wroteManifest = await deps.archive.put(
      `${fileKey.slice(0, -".ndjson".length)}.manifest.json`,
      manifest,
      "application/json",
    );
    return json(200, {
      month,
      rows: lines.length,
      sha256,
      status: wroteFile || wroteManifest ? "archived" : "already_archived",
    });
  } catch (e) {
    deps.alert("audit_export_failed", { month, ...describe(e) });
    return json(500, { error: "export_failed" });
  }
}
