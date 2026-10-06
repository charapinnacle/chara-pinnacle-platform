import type { Database } from "@chara-pinnacle/db-types";

type AccountKind = Database["public"]["Enums"]["account_kind"];

// Who looks at a public vacancy: someone to send to log in (no session, or an account that has not chosen its kind),
// a candidate, who is the only one who can apply and save, or a company user.
export type Viewer = "visitor" | "candidate" | "company";

export function viewerOf(user: { accountKind: AccountKind | null } | null): Viewer {
  if (!user?.accountKind) return "visitor";
  return user.accountKind === "worker" ? "candidate" : "company";
}
