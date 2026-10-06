import { createClient } from "@/lib/supabase/browser";

export type AccessLogItem = {
  id: number;
  organizationName: string | null;
  documentTitle: string | null;
  accessedAt: string;
};

export type AccessLogCursor = { accessedAt: string; id: number };

export const ACCESS_LOG_PAGE_SIZE = 25;

// The candidate's own openings, newest first, read from the browser under the row policy so the screen can show its own
// loading and failure states. Keyset pagination on (accessed_at, id), the order of the owner's index; one extra row says
// whether another page exists. PostgREST has no row comparison, so the cursor is an OR filter, bounded by the rows of
// one candidate.
export async function fetchAccessLog(
  after: AccessLogCursor | null,
): Promise<{ items: AccessLogItem[]; hasMore: boolean }> {
  let query = createClient()
    .from("v_my_document_access_log")
    .select("id, organization_name, document_title, accessed_at")
    .order("accessed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(ACCESS_LOG_PAGE_SIZE + 1);
  if (after) {
    query = query.or(`accessed_at.lt.${after.accessedAt},and(accessed_at.eq.${after.accessedAt},id.lt.${after.id})`);
  }
  const { data, error } = await query;
  if (error) throw new Error("The access log could not be loaded", { cause: error });
  return {
    hasMore: data.length > ACCESS_LOG_PAGE_SIZE,
    items: data.slice(0, ACCESS_LOG_PAGE_SIZE).flatMap((row) =>
      row.id === null || row.accessed_at === null
        ? []
        : [
            {
              id: row.id,
              organizationName: row.organization_name,
              documentTitle: row.document_title,
              accessedAt: row.accessed_at,
            },
          ],
    ),
  };
}
