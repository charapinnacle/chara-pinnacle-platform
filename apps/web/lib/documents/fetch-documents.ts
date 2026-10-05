import { createClient } from "@/lib/supabase/browser";

export type DocumentItem = {
  id: string;
  title: string;
  type: "cv" | "certificate";
  sizeBytes: number;
  createdAt: string;
  expiresOn: string | null;
  scanStatus: string;
};

type DocumentCursor = { createdAt: string; id: string };

export const DOCUMENT_PAGE_SIZE = 25;

// The owner's list, newest first, read from the browser under the row policy so the screen can show its own loading and
// failure states. One page is read with keyset pagination on (created_at, id), the order of the index; one extra row says
// whether another page exists.
export async function fetchDocuments(after: DocumentCursor | null): Promise<{ items: DocumentItem[]; hasMore: boolean }> {
  let query = createClient()
    .from("worker_documents")
    .select("id, title, type, size_bytes, created_at, expires_on, scan_status")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(DOCUMENT_PAGE_SIZE + 1);
  if (after) {
    query = query.or(`created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`);
  }
  const { data, error } = await query;
  if (error) throw new Error("The documents could not be loaded", { cause: error });
  return {
    hasMore: data.length > DOCUMENT_PAGE_SIZE,
    items: data.slice(0, DOCUMENT_PAGE_SIZE).map((row) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      expiresOn: row.expires_on,
      scanStatus: row.scan_status,
    })),
  };
}
