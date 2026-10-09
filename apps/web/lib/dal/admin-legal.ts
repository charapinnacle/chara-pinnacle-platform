import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { adminClient, failure } from "@/lib/dal/admin";

type LegalExportEntry = Database["public"]["Functions"]["admin_export_legal_documents"]["Returns"][number];

const EXPORT_PAGE_SIZE = 25;

// Every published version of every document, one page of the database at a time, so a long archive is never held whole.
// The client is made before the first page is read, while the request is still the current one. A page that fails
// after the first one ends the stream with an error, so the file is cut short and the download fails.
export async function exportLegalDocuments(): Promise<AsyncGenerator<LegalExportEntry[]>> {
  const supabase = await adminClient();

  async function* pages(): AsyncGenerator<LegalExportEntry[]> {
    let after: { slug: string; version: number } | undefined;
    for (;;) {
      const { data, error } = await supabase.rpc("admin_export_legal_documents", {
        p_after_slug: after?.slug,
        p_after_version: after?.version,
        p_limit: EXPORT_PAGE_SIZE,
      });
      if (error) throw failure("The legal documents", error);
      if (data.length === 0) return;
      yield data;
      if (data.length < EXPORT_PAGE_SIZE) return;
      after = data[data.length - 1];
    }
  }

  return pages();
}
