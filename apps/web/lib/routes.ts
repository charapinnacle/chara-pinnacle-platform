import type { Database } from "@chara-pinnacle/db-types";

type AccountKind = Database["public"]["Enums"]["account_kind"];

// A user whose account kind is not committed yet still has the onboarding step to finish.
export function homePath(lang: string, accountKind: AccountKind | null): string {
  if (accountKind === "worker") return `/${lang}/dashboard/worker`;
  if (accountKind === "company") return `/${lang}/dashboard/employer`;
  return `/${lang}/onboarding`;
}
