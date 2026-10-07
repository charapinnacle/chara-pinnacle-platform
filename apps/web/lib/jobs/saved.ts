export const SAVED_PAGE_SIZE = 20;

export const SAVED_HEADING_ID = "saved-heading";

export function savedPath(lang: string, cursor?: string): string {
  return cursor ? `/${lang}/saved?cursor=${encodeURIComponent(cursor)}` : `/${lang}/saved`;
}
