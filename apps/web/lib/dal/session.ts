import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getPendingReconsents } from "@/lib/dal/legal";
import { createClient } from "@/lib/supabase/server";
import { mfaPath } from "@/lib/routes";
import { safeNextPath } from "@/lib/safe-next";
import type { MemberRole } from "@/lib/validation/team";

type AccountKind = Database["public"]["Enums"]["account_kind"];

export const roleRank = { member: 1, admin: 2, owner: 3 } as const satisfies Record<MemberRole, number>;

type CurrentUser = {
  id: string;
  email: string | null;
  aal: "aal1" | "aal2";
  accountKind: AccountKind | null;
  intendedAccountKind: AccountKind | null;
  suspended: boolean;
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data) return null;
  const { sub } = data.claims;
  const { data: profile } = await supabase
    .from("profiles")
    .select("account_kind, intended_account_kind, status")
    .eq("id", sub)
    .maybeSingle();
  if (!profile) return null;
  return {
    id: sub,
    email: data.claims.email ?? null,
    aal: data.claims.aal === "aal2" ? "aal2" : "aal1",
    accountKind: profile.account_kind,
    intendedAccountKind: profile.intended_account_kind,
    suspended: profile.status === "suspended",
  };
});

async function requestedPath(): Promise<string> {
  return safeNextPath((await headers()).get("x-pathname"));
}

// The consent gate runs here, in the DAL, because layouts do not re-render on client navigation.
export async function requireUser(
  lang: string,
  { consentGate = true }: { consentGate?: boolean } = {},
): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const path = await requestedPath();
    redirect(
      path === "/"
        ? `/${lang}/login`
        : `/${lang}/login?next=${encodeURIComponent(path)}`,
    );
  }
  if (user.suspended) redirect(`/${lang}/suspended`);
  if (consentGate && user.accountKind) {
    const pending = await getPendingReconsents();
    if (pending.length > 0) {
      redirect(`/${lang}/consent?next=${encodeURIComponent(await requestedPath())}`);
    }
  }
  return user;
}

// Sends a session that has not passed two-step verification to the MFA page, which enrols a user without a verified
// factor and asks for a code otherwise, and then returns to the page asked for.
async function requireAal2(lang: string, user: CurrentUser): Promise<void> {
  if (user.aal !== "aal2") redirect(mfaPath(lang, await requestedPath()));
}

// The platform roles are looked up, never read from the token. A user who holds no active role gets the forbidden page
// without an MFA prompt; staff must be at aal2 for every administration page (FR-A4).
export async function requirePlatformStaff(lang: string): Promise<CurrentUser> {
  const user = await requireUser(lang);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_platform_roles");
  if (error) throw new Error("The platform roles could not be loaded", { cause: error });
  if (data.length === 0) redirect(`/${lang}/forbidden`);
  await requireAal2(lang, user);
  return user;
}

type OrganizationAccess = { id: string; slug: string; displayName: string; role: MemberRole };

type OrgRoleOptions = {
  // Vacancy pages are not gated by two-step verification (FR-A4 AC3).
  mfa?: boolean;
  // Vacancy pages answer a user who is no member as if the page did not exist (FR-C1).
  hideFromOutsiders?: boolean;
};

// The role is looked up in the database on every request, never read from the token, so a removed or demoted member
// is refused on the very next request. A user who is no member, or whose role is below minRole, gets the forbidden
// page, and so does an unknown slug. Owners and admins must be at aal2 on every organization page (FR-A4); a plain
// member is not asked for two-step verification.
export async function requireOrgRole(
  lang: string,
  slug: string,
  minRole: MemberRole,
  { mfa = true, hideFromOutsiders = false }: OrgRoleOptions = {},
): Promise<{ user: CurrentUser; organization: OrganizationAccess }> {
  const user = await requireUser(lang);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("role, organizations!inner(id, slug, display_name)")
    .eq("user_id", user.id)
    .eq("organizations.slug", slug)
    .not("accepted_at", "is", null)
    .maybeSingle();
  if (error) throw new Error("The organization role could not be loaded", { cause: error });
  if (!data && hideFromOutsiders) notFound();
  if (!data || roleRank[data.role] < roleRank[minRole]) redirect(`/${lang}/forbidden`);
  if (mfa && data.role !== "member") await requireAal2(lang, user);
  const { id, display_name } = data.organizations;
  return { user, organization: { id, slug, displayName: display_name, role: data.role } };
}
