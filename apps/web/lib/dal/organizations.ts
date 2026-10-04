import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

type Organization = { id: string; slug: string; displayName: string; role: "owner" | "admin" | "member" };

// The first organization the user belongs to; choosing between several comes with the team pages.
export const getMyOrganization = cache(async (userId: string): Promise<Organization | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("role, organizations(id, slug, display_name)")
    .eq("user_id", userId)
    .not("accepted_at", "is", null)
    .order("accepted_at")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("The organization could not be loaded", { cause: error });
  if (!data?.organizations) return null;
  const { id, slug, display_name } = data.organizations;
  return { id, slug, displayName: display_name, role: data.role };
});
