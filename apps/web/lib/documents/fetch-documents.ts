import { isAwaitingScan } from "@/lib/documents/presentation";
import { createClient } from "@/lib/supabase/browser";

export type DocumentItem = {
  id: string;
  title: string;
  type: "cv" | "certificate";
  sizeBytes: number;
  createdAt: string;
  expiresOn: string | null;
  scanStatus: string;
  checking: boolean;
};

type DocumentCursor = { createdAt: string; id: string };

const PAGE_SIZE = 25;
// The API returns at most 100 rows and one of them is the probe for another page.
const MAX_PAGE_SIZE = 99;

// The owner's list, newest first, read from the browser under the row policy so the screen can show its own loading and
// failure states. A page is read with keyset pagination on (created_at, id); one extra row says whether another page
// exists, and keep asks for at least that many rows so that a reload does not drop the pages already shown. PostgREST
// has no row comparison, so the cursor is an OR filter: the planner reads the owner's index range and filters it (or
// sorts it), a cost bounded by the documents of one candidate.
export async function fetchDocuments(
  after: DocumentCursor | null,
  keep = 0,
): Promise<{ items: DocumentItem[]; hasMore: boolean }> {
  const size = Math.min(Math.max(keep, PAGE_SIZE), MAX_PAGE_SIZE);
  let query = createClient()
    .from("worker_documents")
    .select("id, title, type, size_bytes, created_at, expires_on, scan_status")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(size + 1);
  if (after) {
    query = query.or(`created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`);
  }
  const { data, error } = await query;
  if (error) throw new Error("The documents could not be loaded", { cause: error });
  return {
    hasMore: data.length > size,
    items: data.slice(0, size).map((row) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      expiresOn: row.expires_on,
      scanStatus: row.scan_status,
      checking: isAwaitingScan(row.scan_status, row.created_at, Date.now()),
    })),
  };
}

// The scope is jsonb, so the value is JSON text; an array would be sent as a Postgres array literal.
export async function fetchShareCount(documentId: string): Promise<number> {
  const { count, error } = await createClient()
    .from("passport_shares")
    .select("id", { count: "exact", head: true })
    .contains("scope", JSON.stringify([documentId]))
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (error) throw new Error("The shares could not be counted", { cause: error });
  return count ?? 0;
}
