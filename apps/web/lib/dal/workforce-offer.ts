import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import type { PartnerKind } from "@/lib/responses/presentation";
import { createClient } from "@/lib/supabase/server";
import type { PartnerType } from "@/lib/validation/sign-up";
import { fromServiceTypes, type WorkforceOfferInput } from "@/lib/validation/workforce-offer";

type Enums = Database["public"]["Enums"];

export type OrganizationWorkforceOffer = {
  occupations: string[];
  industries: string[];
  languages: string[];
  recruitmentType: Enums["recruitment_preference"] | null;
  serviceTypes: Enums["partner_service_type"][];
  sizeBand: Enums["workforce_size_band"] | null;
  foundedYear: number | null;
};

// The workforce offer of a partner (FR-K2), as its members read it; codes sorted.
export async function getWorkforceOffer(organizationId: string): Promise<OrganizationWorkforceOffer> {
  const supabase = await createClient();
  const [occupations, industries, languages, services, organization] = await Promise.all([
    supabase.from("organization_occupations").select("occupation_id").eq("organization_id", organizationId).order("occupation_id"),
    supabase.from("organization_industries").select("industry_code").eq("organization_id", organizationId).order("industry_code"),
    supabase.from("organization_languages").select("language_code").eq("organization_id", organizationId).order("language_code"),
    supabase.from("organization_service_types").select("service").eq("organization_id", organizationId).order("service"),
    supabase
      .from("organizations")
      .select("recruitment_type, workforce_size_band, founded_year")
      .eq("id", organizationId)
      .single(),
  ]);
  const error = occupations.error ?? industries.error ?? languages.error ?? services.error ?? organization.error;
  if (error || !occupations.data || !industries.data || !languages.data || !services.data || !organization.data) {
    throw new Error("The workforce offer of the organisation could not be loaded", { cause: error });
  }
  return {
    occupations: occupations.data.map(({ occupation_id }) => occupation_id),
    industries: industries.data.map(({ industry_code }) => industry_code),
    languages: languages.data.map(({ language_code }) => language_code),
    recruitmentType: organization.data.recruitment_type,
    serviceTypes: services.data.map(({ service }) => service),
    sizeBand: organization.data.workforce_size_band,
    foundedYear: organization.data.founded_year,
  };
}

// What you offer is done once it names an occupation and the recruitment type, and a staffing company a staffing type
// (submission for review needs an occupation, FR-J1 AC10; the recruitment type is required before it, FR-K2).
export function workforceOfferComplete(type: PartnerType, offer: OrganizationWorkforceOffer): boolean {
  const staffingTypeChosen = offer.serviceTypes.some((service) => service !== "staffing");
  return (
    offer.occupations.length > 0 && offer.recruitmentType !== null && (type === "recruitment_company" || staffingTypeChosen)
  );
}

// The saved offer as the values of the What you offer form.
export function workforceOfferDefaults(offer: OrganizationWorkforceOffer): WorkforceOfferInput {
  return {
    occupations: offer.occupations,
    industries: offer.industries,
    languages: offer.languages,
    recruitmentType: offer.recruitmentType ?? "",
    ...fromServiceTypes(offer.serviceTypes),
    sizeBand: offer.sizeBand ?? "",
    foundedYear: offer.foundedYear === null ? "" : String(offer.foundedYear),
  };
}

// Which fee models and terms a partner's responses take (private.partner_kind): a staffing company, a recruitment company,
// or one that also supplies staff.
export async function getPartnerKind(organization: { id: string; type: string }): Promise<PartnerKind> {
  if (organization.type === "staffing_company") return "staffing";
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_service_types")
    .select("service")
    .eq("organization_id", organization.id)
    .eq("service", "staffing");
  if (error) throw new Error("The staffing service could not be loaded", { cause: error });
  return data.length > 0 ? "both" : "recruitment";
}
