import type { SupabaseClient } from "@supabase/supabase-js";
import { json } from "../_shared/http.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BEARER = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const LINK_SECONDS = 60;

interface DocumentUrlDeps {
  userClient: (authorization: string) => SupabaseClient;
  signer: SupabaseClient;
}

interface Grant {
  bucket_id: string;
  object_path: string;
  file_name: string;
}

// What the caller is told: a status and a word, never the database message or a path.
function refusal(error: { code?: string; message?: string }): Response {
  const { code = "", message = "" } = error;
  if (message === "CHARA_FORBIDDEN") {
    return json(403, { error: "forbidden" });
  }
  if (message === "CHARA_NOT_FOUND" || code === "P0002") {
    return json(404, { error: "not_found" });
  }
  if (message === "CHARA_DOCUMENT_NOT_SCANNED") {
    return json(409, { error: "not_scanned" });
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

// Only document_access_grant decides: the function runs it with the caller's own token, so the database sees the
// caller, and it signs a link only for the path the grant returned (after the access-log row exists). The platform
// verifies the JWT (verify_jwt = true); a token it let through but the database rejects ends in a 401 here, before
// anything is signed. A link lives 60 seconds and makes the browser save the file instead of showing it.
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
  const { documentId, purpose } = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof documentId !== "string" || !UUID.test(documentId) || typeof purpose !== "string") {
    return json(400, { error: "bad_request" });
  }

  const { data, error } = await deps.userClient(authorization).rpc("document_access_grant", {
    p_document_id: documentId,
    p_purpose: purpose,
  });
  if (error) {
    return refusal(error);
  }
  const grant = (Array.isArray(data) ? data[0] : null) as Grant | null;
  if (!grant) {
    return json(502, { error: "unavailable" });
  }

  const { data: signed, error: signError } = await deps.signer.storage
    .from(grant.bucket_id)
    .createSignedUrl(grant.object_path, LINK_SECONDS, { download: grant.file_name });
  if (signError) {
    console.error("document-url signing failed");
    return json(502, { error: "unavailable" });
  }
  return json(200, { url: signed.signedUrl });
}
