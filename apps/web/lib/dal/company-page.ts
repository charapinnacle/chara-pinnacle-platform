import "server-only";
import { cache } from "react";
import { companyPageFrom, companyViewerOf, type CompanyPage, type CompanyViewer } from "@/lib/companies/page";
import { createClient } from "@/lib/supabase/server";

export type PublicCompanyPage = { state: "found"; page: CompanyPage; viewer: CompanyViewer } | { state: "not_found" };

// The public company page of an employer (FR-K5), once per request for the page and its metadata. A page that is off, a
// suspended employer, a slug that is not an employer's and a switched-off release are all not_found.
export const getCompanyPage = cache(async (slug: string): Promise<PublicCompanyPage> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_company_page", { p_slug: slug });
  if (error?.message === "CHARA_NOT_FOUND") return { state: "not_found" };
  if (error) throw new Error("The company page could not be loaded", { cause: error });
  const [row] = data;
  if (!row) return { state: "not_found" };
  const { viewer_role: role, ...rest } = row;
  return { state: "found", page: companyPageFrom(rest), viewer: companyViewerOf(role) };
});

// Whether the employer's page is on, for the switch of its owners and administrators; members read their organisation.
export async function getCompanyPageEnabled(organizationId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("organizations").select("public_page_enabled").eq("id", organizationId).single();
  if (error) throw new Error("The company page setting could not be loaded", { cause: error });
  return data.public_page_enabled;
}
