// The supporting documents of a response as the form keeps them while files are sent and scanned (FR-O2 AC5). A file
// gets its row (pending) when its upload URL is signed, before its bytes arrive, so a poll can return a row whose upload
// is still running; the form shows that file as an upload until it settles, never twice.

type Document = { id: string; scanStatus: string; createdAt: string };

// A pending row this old has, as far as the form can tell, lost its upload (the database calls it stranded and no longer
// counts it, V45); the form leaves it out of its count and the database decides.
export const STRANDED_AFTER_MS = 10 * 60 * 1000;

// The rows of a poll, without those whose upload is still running in this form.
export function mergePolled<T extends Document>(polled: readonly T[], uploading: ReadonlySet<string>): T[] {
  const seen = new Set<string>();
  return polled.filter((document) => {
    if (uploading.has(document.id) || seen.has(document.id)) return false;
    seen.add(document.id);
    return true;
  });
}

// The list after an upload settled: the file once, whether the poll already brought its row or not.
export function addDocument<T extends Document>(list: readonly T[], document: T): T[] {
  return list.some((item) => item.id === document.id) ? [...list] : [...list, document];
}

// The files that count against the limit: neither rejected nor, as far as the form can tell, stranded, plus the uploads
// running now (each once, by its row when it has one).
export function countedDocuments(
  documents: readonly Document[],
  uploads: readonly { documentId: string | null }[],
  now: number,
): number {
  const ids = new Set<string>();
  for (const document of documents) {
    if (document.scanStatus === "rejected") continue;
    if (document.scanStatus === "pending" && now - Date.parse(document.createdAt) > STRANDED_AFTER_MS) continue;
    ids.add(document.id);
  }
  let running = 0;
  for (const upload of uploads) {
    if (upload.documentId === null) running += 1;
    else ids.add(upload.documentId);
  }
  return ids.size + running;
}
