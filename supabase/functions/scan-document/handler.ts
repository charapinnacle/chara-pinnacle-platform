import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSharedSecret } from "../_shared/auth.ts";
import { json } from "../_shared/http.ts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// The buckets whose new objects are scanned, the shape of an object name (the second folder is the id of the row the file
// belongs to) and the service RPC that records the verdict on that row. Candidate documents are named
// {user_id}/{document_id}/{file_name} by the storage policy; licence evidence {organization_id}/{licence_id}/{uuid} by
// partner_document_access_grant (FR-J2).
const TARGETS: Readonly<Record<string, { name: RegExp; rpc: string; idParam: string }>> = {
  "passport-documents": {
    name: new RegExp(`^${UUID}/(${UUID})/[A-Za-z0-9._-]{1,100}$`, "i"),
    rpc: "document_set_scan_status",
    idParam: "p_document_id",
  },
  "partner-documents": {
    name: new RegExp(`^${UUID}/(${UUID})/${UUID}$`, "i"),
    rpc: "partner_document_set_scan_status",
    idParam: "p_licence",
  },
};
const HEAD_BYTES = 8;
// No scanning vendor is chosen yet (OPEN_QUESTIONS.md O4): a file whose first bytes are what it claims to be is recorded
// as skipped, and the documents are served download-only. A vendor adds the status clean here.
const VERIFIED_STATUS = "skipped";
const NOT_FOUND = "P0002";

interface ScanDeps {
  client: SupabaseClient;
  sharedSecret: string;
  fetch: typeof fetch;
}

interface ObjectRecord {
  bucket: string;
  rpc: string;
  idParam: string;
  rowId: string;
  path: string;
  mimetype: string | null;
  size: number | null;
}

const SIGNATURES: readonly { type: string; bytes: readonly number[] }[] = [
  { type: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { type: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

export function detectType(head: Uint8Array): string | null {
  const match = SIGNATURES.find(({ bytes }) => bytes.every((byte, index) => head[index] === byte));
  return match?.type ?? null;
}

// The webhook of the database sends the new row of storage.objects; anything that is not an insert into one of the
// buckets above, at a name of its shape, is not ours to scan.
function parseRecord(payload: unknown): ObjectRecord | "other" | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const { type, schema, table, record } = payload as Record<string, unknown>;
  if (
    type !== "INSERT" || schema !== "storage" || table !== "objects" || typeof record !== "object" || record === null
  ) {
    return null;
  }
  const { bucket_id: bucket, name, metadata } = record as Record<string, unknown>;
  const target = typeof bucket === "string" && Object.hasOwn(TARGETS, bucket) ? TARGETS[bucket] : null;
  if (!target) {
    return "other";
  }
  const parts = typeof name === "string" ? target.name.exec(name) : null;
  if (!parts) {
    return "other";
  }
  const stored = typeof metadata === "object" && metadata !== null ? (metadata as Record<string, unknown>) : {};
  return {
    bucket: bucket as string,
    rpc: target.rpc,
    idParam: target.idParam,
    rowId: parts[1].toLowerCase(),
    path: name as string,
    mimetype: typeof stored.mimetype === "string" ? stored.mimetype.split(";")[0].trim().toLowerCase() : null,
    size: typeof stored.size === "number" ? stored.size : null,
  };
}

// A range request fetches the first bytes only; a server that ignores the range still costs at most the first chunk,
// because the stream is cancelled once enough bytes have arrived.
async function readHead(deps: ScanDeps, bucket: string, path: string): Promise<Uint8Array> {
  const { data, error } = await deps.client.storage.from(bucket).createSignedUrl(path, 60);
  if (error) {
    throw error;
  }
  const response = await deps.fetch(data.signedUrl, { headers: { range: `bytes=0-${HEAD_BYTES - 1}` } });
  if (!response.ok || !response.body) {
    throw new Error(`object read answered ${response.status}`, { cause: { status: response.status } });
  }
  const reader = response.body.getReader();
  const head = new Uint8Array(HEAD_BYTES);
  let filled = 0;
  while (filled < HEAD_BYTES) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const chunk = value.subarray(0, HEAD_BYTES - filled);
    head.set(chunk, filled);
    filled += chunk.length;
  }
  await reader.cancel();
  return head.subarray(0, filled);
}

function failure(error: unknown): void {
  const { status, code, error_code: errorCode, cause } = (typeof error === "object" && error !== null ? error : {}) as {
    status?: unknown;
    code?: unknown;
    error_code?: unknown;
    cause?: { status?: unknown };
  };
  const bounded = (value: unknown) => (typeof value === "string" || typeof value === "number" ? value : undefined);
  console.error("scan-document failed", { status: bounded(status ?? cause?.status), code: bounded(code ?? errorCode) });
}

// Idempotent: the database leaves a row that is no longer pending as it is, so a repeated webhook is harmless, and it
// compares the object name, stored type and size with the row. A failure leaves the row pending and answers 502; the
// database announces a pending object again every minute (private.rescan_pending_documents).
export async function handleScanDocument(req: Request, deps: ScanDeps): Promise<Response> {
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }
  if (!hasSharedSecret(req, deps.sharedSecret)) {
    return json(401, { error: "unauthorized" });
  }
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const record = parseRecord(payload);
  if (!record) {
    return json(400, { error: "bad_request" });
  }
  if (record === "other") {
    return json(200, { status: "ignored" });
  }

  try {
    const detected = detectType(await readHead(deps, record.bucket, record.path));
    const verdict = detected !== null && detected === record.mimetype ? VERIFIED_STATUS : "rejected";
    const { data, error } = await deps.client.rpc(record.rpc, {
      [record.idParam]: record.rowId,
      p_path: record.path,
      p_status: verdict,
      p_mime: record.mimetype,
      p_size: record.size,
    });
    if (error?.code === NOT_FOUND) {
      return json(200, { status: "unknown_document" });
    }
    if (error) {
      throw error;
    }
    return json(200, { status: data });
  } catch (e) {
    failure(e);
    return json(502, { error: "unavailable" });
  }
}
