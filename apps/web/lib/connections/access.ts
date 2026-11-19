import type { Database } from "@chara-pinnacle/db-types";

type AccountKind = Database["public"]["Enums"]["account_kind"];
type OrganizationType = Database["public"]["Enums"]["organization_type"];

type Viewer = { accountKind: AccountKind | null; suspended: boolean } | null;
type ViewerOrganization = { id: string; type: OrganizationType; suspended: boolean };

// What a viewer may do with a company on its card, profile or page (FR-L4 roles; FR-K4 AC4; FR-K5 AC8):
//   visitor    no session, or an account that has not chosen its kind: Follow leads to log in
//   none       a member of the company itself, or a suspended account: no Save or Follow
//   signed_in  saveFor is the employer that saves a partner (the first one the viewer joined, as the dashboard, unless a
//              page of one of the viewer's employers names it as saveFor), or null;
//              follow is false for a member of an employer looking at another employer (FR-K5 open point: no)
export type ConnectionAccess =
  | { kind: "visitor" }
  | { kind: "none" }
  | { kind: "signed_in"; saveFor: string | null; follow: boolean };

export function connectionAccess(
  viewer: Viewer,
  organizations: readonly ViewerOrganization[],
  target: { id: string; type: OrganizationType },
  saveFor?: string,
): ConnectionAccess {
  if (!viewer?.accountKind) return { kind: "visitor" };
  if (viewer.suspended || organizations.some(({ id }) => id === target.id)) return { kind: "none" };
  const employers = organizations.filter(({ type }) => type === "employer");
  const targetIsEmployer = target.type === "employer";
  const savers = employers.filter(({ suspended }) => !suspended);
  const saver = targetIsEmployer ? undefined : (savers.find(({ id }) => id === saveFor) ?? savers[0])?.id;
  return { kind: "signed_in", saveFor: saver ?? null, follow: !(targetIsEmployer && employers.length > 0) };
}

export function hasConnectionActions(access: ConnectionAccess): boolean {
  return access.kind === "visitor" || (access.kind === "signed_in" && (access.saveFor !== null || access.follow));
}

// "Followers: 7", or "Followers: fewer than 5" below the minimum count, which names no number (FR-L4 AC5, AC11).
export type FollowerCount = { count: number } | { fewerThan: number };

export function followerCountText(followers: FollowerCount): string {
  return "count" in followers ? `Followers: ${followers.count}` : `Followers: fewer than ${followers.fewerThan}`;
}
