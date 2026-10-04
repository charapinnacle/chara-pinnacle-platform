import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getPendingReconsents } from "@/lib/dal/legal";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-next";

type AccountKind = Database["public"]["Enums"]["account_kind"];

type CurrentUser = {
  id: string;
  accountKind: AccountKind | null;
  intendedAccountKind: AccountKind;
  suspended: boolean;
};

const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
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
