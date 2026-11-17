// Apart from the drafts themselves so that log out, on every page, clears them without loading their schema and zod.
const PREFIX = "chara:requirement-draft:";

export const requirementDraftKey = (userId: string, slug: string) => `${PREFIX}${userId}:${slug}`;

// Every requirement draft of the tab, whoever wrote it: called before log out.
export function clearRequirementDrafts(): void {
  try {
    const keys = Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index));
    for (const key of keys) if (key?.startsWith(PREFIX)) window.sessionStorage.removeItem(key);
  } catch {
    // Unreadable or blocked storage holds no draft to clear.
  }
}
