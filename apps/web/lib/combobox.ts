export type ComboboxOption = { value: string; label: string; keywords?: string };

// The list in the page never holds more rows than this, however long the reference list is (255 countries, 441 occupations).
export const COMBOBOX_LIMIT = 50;

export type ComboboxMatches = { shown: readonly ComboboxOption[]; total: number };

// Where the list starts when no text is typed: at the top, or, for a chosen option beyond the limit, at that option (or as
// far down as still fills the list), so a reopened list shows the current choice.
export function listStart(total: number, chosenIndex: number): number {
  return chosenIndex < COMBOBOX_LIMIT ? 0 : Math.min(chosenIndex, total - COMBOBOX_LIMIT);
}

export function matchOptions(options: readonly ComboboxOption[], query: string, chosenIndex = -1): ComboboxMatches {
  const needle = query.trim().toLowerCase();
  const found = needle
    ? options.filter((option) => `${option.label} ${option.keywords ?? ""}`.toLowerCase().includes(needle))
    : options;
  const start = needle ? 0 : listStart(found.length, chosenIndex);
  return { shown: found.slice(start, start + COMBOBOX_LIMIT), total: found.length };
}

type ActiveKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

// The index of the highlighted option after a key, in a list of count options; -1 means none. The list stops at its ends.
export function moveActive(key: ActiveKey, active: number, count: number): number {
  if (count === 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return Math.min(active + 1, count - 1);
  return Math.max(active - 1, 0);
}

export function resultsAnnouncement({ shown, total }: ComboboxMatches, emptyText: string): string {
  if (total === 0) return emptyText;
  const results = `${total} ${total === 1 ? "result" : "results"} available`;
  return total > shown.length ? `${results}, ${shown.length} are listed. Type to narrow the list.` : results;
}
