import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { MemberRole } from "@/lib/validation/team";

type Organization = { id: string; slug: string; displayName: string; role: MemberRole; suspended: boolean };

const MAX_LISTED_ORGANIZATIONS = 20;

// Oldest membership first, so the first entry is the organization the user registered or joined first.
export const getMyOrganizations = cache(async (userId: string): Promise<Organization[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("role, organizations(id, slug, display_name, status)")
    .eq("user_id", userId)
    .not("accepted_at", "is", null)
    .order("accepted_at")
    .limit(MAX_LISTED_ORGANIZATIONS);
  if (error) throw new Error("The organizations could not be loaded", { cause: error });
  return data.flatMap(({ role, organizations }) =>
    organizations
      ? [
          {
            id: organizations.id,
            slug: organizations.slug,
            displayName: organizations.display_name,
            role,
            suspended: organizations.status === "suspended",
          },
        ]
      : [],
  );
});

export async function getOrganizationSlug(organizationId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("organizations").select("slug").eq("id", organizationId).maybeSingle();
  if (error) throw new Error("The organization could not be loaded", { cause: error });
  return data?.slug ?? null;
}

export async function getMyOrganization(userId: string): Promise<Organization | null> {
  return (await getMyOrganizations(userId))[0] ?? null;
}
