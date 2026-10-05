import type { ReferenceItem } from "@/lib/dal/reference";

export function toOptions(items: readonly ReferenceItem[]) {
  return items.map(({ code, name }) => ({ value: code, label: name }));
}
