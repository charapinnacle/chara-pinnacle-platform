const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const BARE_ID = new RegExp(`^${UUID}$`, "i");
const VACANCY_PATH = new RegExp(`(?:^|/)jobs/(${UUID})(?:[/?#]|$)`, "i");

// The same shape as the check constraint of reports.content_path.
const CONTENT_PATH = /^\/[A-Za-z0-9._~%/-]{1,255}$/;

// What a person pastes to name a vacancy: the address of its page, with or without the host, or its id. Anything else
// gives null. Whether the vacancy is public is the database's to say.
export function vacancyIdFrom(input: string): string | null {
  const text = input.trim();
  if (BARE_ID.test(text)) return text.toLowerCase();
  return VACANCY_PATH.exec(text)?.[1].toLowerCase() ?? null;
}

// The page a person names: a path of this site, or the address of one. The query and the fragment are dropped and a
// trailing slash is not part of the path, so the same page is always reported as the same path.
export function contentPathFrom(input: string): string | null {
  const text = input.trim();
  let path = text;
  if (!text.startsWith("/")) {
    try {
      path = new URL(text).pathname;
    } catch {
      return null;
    }
  } else {
    path = text.split(/[?#]/, 1)[0];
  }
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return CONTENT_PATH.test(trimmed) && !/\/\/|\.\./.test(trimmed) ? trimmed : null;
}
