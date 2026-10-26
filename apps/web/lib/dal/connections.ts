import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import * as z from "zod";
import { connectionAccess, type ConnectionAccess, type FollowerCount } from "@/lib/connections/access";
import { getMyOrganizations } from "@/lib/dal/organizations";
import { getCurrentUser } from "@/lib/dal/session";
import { createClient } from "@/lib/supabase/server";

type OrganizationType = Database["public"]["Enums"]["organization_type"];

export const CONNECTIONS_PAGE_SIZE = 20;

export type ConnectionTarget = { id: string; type: OrganizationType };

// What the viewer may do with each company and whether it already saved or follows it (FR-L4 AC9), for one profile,
// page or page of cards. Row level security answers each question for the viewer only: the saves of their organisation
// and their own follows.
export async function getConnectionStates(targets: readonly ConnectionTarget[]): Promise<{
  access: Map<string, ConnectionAccess>;
  saved: Set<string>;
  followed: Set<string>;
}> {
  const user = await getCurrentUser();
  const organizations = user?.accountKind ? await getMyOrganizations(user.id) : [];
  const access = new Map(targets.map((target) => [target.id, connectionAccess(user, organizations, target)]));
  const signedIn = [...access.entries()].filter(([, entry]) => entry.kind === "signed_in");
  if (signedIn.length === 0) return { access, saved: new Set(), followed: new Set() };

  const supabase = await createClient();
  const ids = signedIn.map(([id]) => id);
  const saveFor = signedIn.map(([, entry]) => (entry.kind === "signed_in" ? entry.saveFor : null)).find((id) => id !== null);
  const [follows, saves] = await Promise.all([
    supabase.from("follows").select("organization_id").in("organization_id", ids),
    saveFor
      ? supabase.from("saved_items").select("target_organization_id").eq("organization_id", saveFor).in("target_organization_id", ids)
      : null,
  ]);
  if (follows.error) throw new Error("The followed companies could not be loaded", { cause: follows.error });
  if (saves?.error) throw new Error("The saved partners could not be loaded", { cause: saves.error });
  return {
    access,
    saved: new Set((saves?.data ?? []).map((row) => row.target_organization_id)),
    followed: new Set(follows.data.map((row) => row.organization_id)),
  };
}

// The company behind a public slug for a signed-in viewer, null for a visitor (who needs no id) and for a company that
// cannot be followed.
export async function getConnectionTarget(slug: string): Promise<ConnectionTarget | null> {
  if (!(await getCurrentUser())) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("connection_target", { p_slug: slug });
  if (error) throw new Error("The company could not be loaded", { cause: error });
  const [row] = data;
  return row ? { id: row.organization_id, type: row.organization_type } : null;
}

// Save partner and Follow for one public profile or page: what the viewer may do and whether it is done already.
export async function getProfileConnection(
  slug: string,
): Promise<{ id: string | null; access: ConnectionAccess; saved: boolean; following: boolean }> {
  const target = await getConnectionTarget(slug);
  if (!target) {
    const user = await getCurrentUser();
    return { id: null, access: user?.accountKind ? { kind: "none" } : { kind: "visitor" }, saved: false, following: false };
  }
  const { access, saved, followed } = await getConnectionStates([target]);
  return {
    id: target.id,
    access: access.get(target.id) ?? { kind: "none" },
    saved: saved.has(target.id),
    following: followed.has(target.id),
  };
}

const namedSchema = z.array(z.object({ code: z.string(), name: z.string() }));

export type SavedPartner = {
  id: string;
  slug: string;
  displayName: string;
  organizationType: OrganizationType;
  basedIn: string;
  servedCountries: string[];
  savedAt: string;
};

// One page of the public partners an employer saved, newest first (FR-L4 AC10); total counts them over every page.
export async function listSavedPartners(
  organizationId: string,
  cursor: string | null,
  limit = CONNECTIONS_PAGE_SIZE,
): Promise<{ partners: SavedPartner[]; total: number; nextCursor: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_saved_partners", {
    p_org: organizationId,
    p_cursor: cursor ?? undefined,
    p_limit: limit,
  });
  if (error) throw new Error("The saved partners could not be loaded", { cause: error });
  return {
    partners: data.map((row) => ({
      id: row.partner_id,
      slug: row.slug,
      displayName: row.display_name,
      organizationType: row.organization_type,
      basedIn: row.based_in_country_name,
      servedCountries: namedSchema.parse(row.served_countries).map((country) => country.name),
      savedAt: row.saved_at,
    })),
    total: data[0]?.total ?? 0,
    nextCursor: data.at(-1)?.next_cursor ?? null,
  };
}

export type FollowedCompany = {
  id: string;
  slug: string;
  displayName: string;
  organizationType: OrganizationType;
  basedIn: string;
  followedAt: string;
};

// One page of the companies the user follows that can still be followed, newest first (FR-L4 AC8, AC10).
export async function listFollowedCompanies(
  cursor: string | null,
  limit = CONNECTIONS_PAGE_SIZE,
): Promise<{ companies: FollowedCompany[]; total: number; nextCursor: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_followed_companies", { p_cursor: cursor ?? undefined, p_limit: limit });
  if (error) throw new Error("The followed companies could not be loaded", { cause: error });
  return {
    companies: data.map((row) => ({
      id: row.organization_id,
      slug: row.slug,
      displayName: row.display_name,
      organizationType: row.organization_type,
      basedIn: row.based_in_country_name,
      followedAt: row.followed_at,
    })),
    total: data[0]?.total ?? 0,
    nextCursor: data.at(-1)?.next_cursor ?? null,
  };
}

// The number of saved partners and followed companies a dashboard card shows: the total of the first row of the list.
export async function countSavedPartners(organizationId: string): Promise<number> {
  return (await listSavedPartners(organizationId, null, 1)).total;
}

export async function countFollowedCompanies(): Promise<number> {
  return (await listFollowedCompanies(null, 1)).total;
}

const followerCountSchema = z.union([
  z.object({ count: z.number().int().nonnegative() }),
  z.object({ count: z.null(), fewer_than: z.number().int().positive() }),
]);

// The follower count of an organisation for its own members (FR-L4 AC5, AC11): never who follows.
export async function getFollowerCount(organizationId: string): Promise<FollowerCount> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("follower_count", { p_org: organizationId });
  if (error) throw new Error("The follower count could not be loaded", { cause: error });
  const parsed = followerCountSchema.parse(data);
  return parsed.count === null ? { fewerThan: parsed.fewer_than } : { count: parsed.count };
}
