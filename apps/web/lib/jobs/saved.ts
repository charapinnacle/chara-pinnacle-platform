import { parseJobCursor } from "@/lib/validation/job";

export const SAVED_PAGE_SIZE = 20;

// A row that is removed from the list takes the focus with it, so the page heading receives it.
export const SAVED_HEADING_ID = "saved-heading";

// The exact shape of the next_cursor list_saved_jobs returns: the saving time in UTC with microseconds, and the id. A
// cursor the function would refuse is dropped here, so a mistyped address shows the first page, not an error page.
const SAVED_CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseSavedCursor(value: unknown): string | null {
  return typeof value === "string" && SAVED_CURSOR.test(value) && parseJobCursor(value) ? value : null;
}

export function savedPath(lang: string, cursor?: string): string {
  return cursor ? `/${lang}/saved?cursor=${encodeURIComponent(cursor)}` : `/${lang}/saved`;
}
