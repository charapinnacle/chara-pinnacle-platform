import "server-only";
import * as z from "zod";
import { isExportState, type ExportState } from "@/lib/data-export/presentation";
import { env } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";

export type DataExport = {
  id: string;
  state: ExportState;
  requestedAt: string;
  readyAt: string | null;
  expiresAt: string | null;
  sizeBytes: number | null;
};

export type DataExports = { exports: DataExport[]; nextRequestAt: string | null };

// The caller's requests for a copy of their data, newest first (FR-S3 AC8), and when a new one is accepted.
export async function listMyDataExports(): Promise<DataExports> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_data_exports");
  if (error) throw new Error("The data exports could not be loaded", { cause: error });
  return {
    exports: data.flatMap((row) =>
      isExportState(row.state)
        ? [{
            id: row.id,
            state: row.state,
            requestedAt: row.requested_at,
            readyAt: row.ready_at ?? null,
            expiresAt: row.expires_at ?? null,
            sizeBytes: row.size_bytes ?? null,
          }]
        : [],
    ),
    nextRequestAt: data[0]?.next_request_at ?? null,
  };
}

export type DataExportLink = { url: string } | { refusal: "unavailable" | "rate_limited" | "failed" };

const linkSchema = z.object({ url: z.url({ protocol: /^https?$/ }) });

// A 10-minute download link to the owner's ready export from the document-url function, which runs
// data_export_access_grant with the owner's own token: the owner, the state, the expiry and the audit row are the
// database's.
export async function requestDataExportLink(exportId: string): Promise<DataExportLink> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) return { refusal: "failed" };
  const endpoint = serverEnv().DOCUMENT_URL_ENDPOINT ?? `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/document-url`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${data.session.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ exportId, purpose: "data_export" }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { refusal: "failed" };
  }
  if (response.status === 403 || response.status === 404) return { refusal: "unavailable" };
  if (response.status === 429) return { refusal: "rate_limited" };
  const parsed = response.ok ? linkSchema.safeParse(await response.json().catch(() => null)) : null;
  return parsed?.success ? parsed.data : { refusal: "failed" };
}
