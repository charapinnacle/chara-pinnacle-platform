import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/dal/session";
import { createClient } from "@/lib/supabase/server";
import type { OrganizationProfileInput } from "@/lib/validation/organization";
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

// The organization in which the user may publish vacancies: an owner or an admin of one that is not suspended.
export function publishingOrganization(organizations: Organization[]): Organization | undefined {
  return organizations.find(({ role, suspended }) => role !== "member" && !suspended);
}

// Where Post a job leads, for the header and the home page alike. Everyone goes through /post-job: a visitor is asked to
// log in there (the login page links to sign-up), and an employer is sent on to the new-vacancy page of the organisation
// (the address of an organisation is not put on a public page). A candidate, a suspended account and a member who cannot
// publish are offered nothing (null).
export const getPostJobHref = cache(async (lang: string): Promise<string | null> => {
  const user = await getCurrentUser();
  if (!user) return `/${lang}/post-job`;
  if (user.suspended || user.accountKind !== "company") return null;
  try {
    const organizations = await getMyOrganizations(user.id);
    const mayPublish = organizations.length === 0 || publishingOrganization(organizations) !== undefined;
    return mayPublish ? `/${lang}/post-job` : null;
  } catch (error) {
    console.error("The organisations of Post a Job could not be loaded", error);
    return `/${lang}/post-job`;
  }
});

export async function getOrganizationSlug(organizationId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("organizations").select("slug").eq("id", organizationId).maybeSingle();
  if (error) throw new Error("The organization could not be loaded", { cause: error });
  return data?.slug ?? null;
}

// The company details as the profile form edits them: codes for the lists and an empty string for a missing website.
export async function getOrganizationProfile(organizationId: string): Promise<OrganizationProfileInput | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("legal_name, display_name, based_in_country, industry_code, website, description")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw new Error("The organization profile could not be loaded", { cause: error });
  return (
    data && {
      legalName: data.legal_name,
      displayName: data.display_name,
      country: data.based_in_country,
      industry: data.industry_code ?? "",
      website: data.website ?? "",
      description: data.description ?? "",
    }
  );
}

export async function getMyOrganization(userId: string): Promise<Organization | null> {
  return (await getMyOrganizations(userId))[0] ?? null;
}
