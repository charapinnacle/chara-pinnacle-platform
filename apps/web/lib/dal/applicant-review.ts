import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import * as z from "@/lib/zod";
import { parseSnapshot, type ApplicantSnapshot } from "@/lib/applicants/snapshot";
import { env } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";

type DocumentType = Database["public"]["Enums"]["worker_document_type"];

type ApplicantProfile = { snapshot: ApplicantSnapshot; coverNote: string | null };

export type SharedDocument = {
  id: string;
  title: string;
  type: DocumentType;
  fileName: string;
  sizeBytes: number;
  expiresOn: string | null;
  available: boolean;
};

export type ApplicantNote = { id: number; authorName: string | null; body: string; createdAt: string };

type NotesPage = { notes: ApplicantNote[]; hasMore: boolean };

export type NoteRefusal = "not_found" | "read_only_free_plan" | "organization_suspended" | "invalid" | "failed";

type DocumentLink =
  | { url: string }
  | { refusal: "unavailable" | "not_scanned" | "rate_limited" | "failed" };

// The row policy of the applications shows a member the applications of the active organizations they belong to, so an
// application of anyone else is no row.
export async function getApplicantProfile(id: string): Promise<ApplicantProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_applications")
    .select("profile_snapshot, cover_note")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("The profile could not be loaded", { cause: error });
  return data ? { snapshot: parseSnapshot(data.profile_snapshot), coverNote: data.cover_note } : null;
}

export async function listSharedDocuments(id: string): Promise<SharedDocument[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("application_documents", { p_application_id: id });
  if (error) throw new Error("The documents could not be loaded", { cause: error });
  return data.map((row) => ({
    id: row.id,
    title: row.title,
    type: row.type,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    expiresOn: row.expires_on,
    available: row.available,
  }));
}

// true when the live profile differs in content from the snapshot, false when it does not, null when the share has ended
// and the live profile is not read.
export async function isProfileChanged(id: string): Promise<boolean | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("application_profile_changed", { p_application_id: id });
  if (error) throw new Error("The profile check could not be loaded", { cause: error });
  return data;
}

// One page of notes, newest first; beforeId is the id of the last note of the page before. The database sets the page
// size and says whether older notes exist.
export async function listApplicationNotes(id: string, beforeId?: number): Promise<NotesPage> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_application_notes", { p_application_id: id, p_before_id: beforeId });
  if (error) throw new Error("The notes could not be loaded", { cause: error });
  return {
    notes: data.map((row) => ({ id: row.id, authorName: row.author_name, body: row.body, createdAt: row.created_at })),
    hasMore: data.some((row) => row.has_more),
  };
}

// The insert is the member's own: the policy checks the membership and the author, the guard trigger the status and the
// plan of the organization.
export async function addApplicationNote(applicationId: string, organizationId: string, body: string): Promise<NoteRefusal | null> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("application_notes")
    .insert({ application_id: applicationId, organization_id: organizationId, body });
  if (!error) return null;
  if (error.message === "CHARA_FEATURE_NOT_IN_PLAN") return "read_only_free_plan";
  if (error.message === "CHARA_FORBIDDEN") return "organization_suspended";
  if (error.code === "23503" || error.code === "42501") return "not_found";
  if (error.code === "23514") return "invalid";
  console.error("Adding a note failed", { code: error.code, message: error.message });
  return "failed";
}

const linkSchema = z.object({ url: z.url({ protocol: /^https?$/ }) });

// A 60-second link to a shared document from the document-url function, which runs document_access_grant with the
// member's own token: the share, the scan state, the allowance and the access log are the database's. The function is
// the only holder of the key that signs the link; this server only forwards the member's session.
export async function requestDocumentLink(documentId: string): Promise<DocumentLink> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) return { refusal: "failed" };
  const endpoint = serverEnv().DOCUMENT_URL_ENDPOINT ?? `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/document-url`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${data.session.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ documentId, purpose: "application_review" }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { refusal: "failed" };
  }
  if (response.status === 403 || response.status === 404) return { refusal: "unavailable" };
  if (response.status === 409) return { refusal: "not_scanned" };
  if (response.status === 429) return { refusal: "rate_limited" };
  const link = response.ok ? linkSchema.safeParse(await response.json().catch(() => null)) : null;
  return link?.success ? { url: link.data.url } : { refusal: "failed" };
}
