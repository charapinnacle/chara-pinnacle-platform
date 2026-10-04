import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getPendingReconsents } from "@/lib/dal/legal";
import { createClient } from "@/lib/supabase/server";
import { mfaPath } from "@/lib/routes";
import { safeNextPath } from "@/lib/safe-next";

type AccountKind = Database["public"]["Enums"]["account_kind"];

type CurrentUser = {
  id: string;
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
export async function requireAal2(lang: string, user: CurrentUser): Promise<void> {
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
