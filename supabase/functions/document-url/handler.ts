import type { SupabaseClient } from "@supabase/supabase-js";
import { json } from "../_shared/http.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BEARER = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const LINK_SECONDS = 60;
// A copy of the user's own data (FR-S3 AC8) is a larger file: its link lives 10 minutes.
const EXPORT_LINK_SECONDS = 600;

interface DocumentUrlDeps {
  userClient: (authorization: string) => SupabaseClient;
  signer: SupabaseClient;
}

interface Grant {
  bucket_id: string;
  object_path: string;
  file_name: string | null;
}

// Licence evidence (FR-J2): the owner or an admin uploads through a URL signed for the one object name the grant reserved
// (an upload URL lives as long as Storage makes it; the database accepts the file only while the name is still reserved),
// and staff open a scanned file through a 60-second download link.
type Ask =
  | { rpc: "document_access_grant"; args: { p_document_id: string; p_purpose: string }; upload: false }
  | { rpc: "data_export_access_grant"; args: { p_export: string }; upload: false }
  | {
    rpc: "partner_document_access_grant";
    args: { p_licence: string; p_purpose: string; p_mime?: string; p_size?: number };
    upload: boolean;
  };

const EVIDENCE_UPLOAD = "evidence_upload";
const DATA_EXPORT = "data_export";

function parseAsk(body: unknown): Ask | null {
  const { documentId, licenceId, exportId, purpose, mime, size } =
    (typeof body === "object" && body !== null ? body : {}) as Record<
      string,
      unknown
    >;
  if (typeof purpose !== "string") {
    return null;
  }
  if (exportId !== undefined) {
    return typeof exportId === "string" && UUID.test(exportId) && purpose === DATA_EXPORT && documentId === undefined &&
        licenceId === undefined
      ? { rpc: "data_export_access_grant", args: { p_export: exportId }, upload: false }
      : null;
  }
  if (typeof documentId === "string" && UUID.test(documentId) && licenceId === undefined) {
    return { rpc: "document_access_grant", args: { p_document_id: documentId, p_purpose: purpose }, upload: false };
  }
  if (typeof licenceId !== "string" || !UUID.test(licenceId) || documentId !== undefined) {
    return null;
  }
  if (purpose !== EVIDENCE_UPLOAD) {
    return { rpc: "partner_document_access_grant", args: { p_licence: licenceId, p_purpose: purpose }, upload: false };
  }
  if (typeof mime !== "string" || mime.length > 100 || typeof size !== "number" || !Number.isSafeInteger(size)) {
    return null;
  }
  return {
    rpc: "partner_document_access_grant",
    args: { p_licence: licenceId, p_purpose: purpose, p_mime: mime, p_size: size },
    upload: true,
  };
}

function refusal(error: { code?: string; message?: string; details?: string | null }): Response {
  const { code = "", message = "", details } = error;
  if (message === "CHARA_FORBIDDEN") {
    return json(403, { error: "forbidden" });
  }
  if (message === "CHARA_NOT_FOUND" || code === "P0002") {
    return json(404, { error: "not_found" });
  }
  if (message === "CHARA_DOCUMENT_NOT_SCANNED") {
    return json(409, { error: "not_scanned" });
  }
  if (message === "CHARA_INVALID_INPUT") {
    return json(400, { error: details === "file" ? "invalid_file" : "bad_request" });
  }
  if (message === "CHARA_RATE_LIMITED") {
    return json(429, { error: "rate_limited" });
  }
  // The anon key as a bearer, a role without the grant, a user id missing from the token, an expired or invalid token.
  if (
    message === "CHARA_UNAUTHENTICATED" || message.startsWith("permission denied") || code.startsWith("PGRST30")
  ) {
    return json(401, { error: "unauthorized" });
  }
  if (code === "22P02" || code === "23502" || code === "23514") {
    return json(400, { error: "bad_request" });
  }
  console.error("document-url failed", { code: code.slice(0, 16) });
  return json(502, { error: "unavailable" });
}

export async function handleDocumentUrl(req: Request, deps: DocumentUrlDeps): Promise<Response> {
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }
  const authorization = req.headers.get("authorization") ?? "";
  if (!BEARER.test(authorization)) {
    return json(401, { error: "unauthorized" });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const ask = parseAsk(body);
  if (!ask) {
    return json(400, { error: "bad_request" });
  }

  const { data, error } = await deps.userClient(authorization).rpc(ask.rpc, ask.args);
  if (error) {
    return refusal(error);
  }
  const grant = (Array.isArray(data) ? data[0] : null) as Grant | null;
  if (!grant) {
    return json(502, { error: "unavailable" });
  }

  const bucket = deps.signer.storage.from(grant.bucket_id);
  if (ask.upload) {
    const { data: upload, error: uploadError } = await bucket.createSignedUploadUrl(grant.object_path);
    if (uploadError) {
      console.error("document-url signing failed");
      return json(502, { error: "unavailable" });
    }
    return json(200, { path: upload.path, token: upload.token });
  }
  const seconds = ask.rpc === "data_export_access_grant" ? EXPORT_LINK_SECONDS : LINK_SECONDS;
  const { data: signed, error: signError } = await bucket.createSignedUrl(grant.object_path, seconds, {
    download: grant.file_name ?? true,
  });
  if (signError) {
    console.error("document-url signing failed");
    return json(502, { error: "unavailable" });
  }
  return json(200, { url: signed.signedUrl });
}
