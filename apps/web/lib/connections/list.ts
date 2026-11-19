import type { Database } from "@chara-pinnacle/db-types";
import type { FollowedCompany, SavedPartner } from "@/lib/dal/connections";
import { companyPagePath, partnerProfilePath } from "@/lib/routes";

type OrganizationType = Database["public"]["Enums"]["organization_type"];

export type ConnectionItem = { id: string; name: string; href: string; details: string[]; at: string };

const typeLabels: Record<OrganizationType, string> = {
  employer: "Employer",
  recruitment_company: "Recruitment company",
  staffing_company: "Staffing company",
};

export const SAVED_PARTNERS_HEADING_ID = "saved-partners-heading";
export const FOLLOWING_HEADING_ID = "following-heading";

// A saved partner as its row shows it (FR-L4 AC10): display name, based in and the countries it serves.
export function savedPartnerItem(lang: string, partner: SavedPartner): ConnectionItem {
  return {
    id: partner.id,
    name: partner.displayName,
    href: partnerProfilePath(lang, partner.slug),
    details: [
      `${typeLabels[partner.organizationType]}, based in ${partner.basedIn}`,
      ...(partner.servedCountries.length > 0 ? [`Serves ${partner.servedCountries.join(", ")}`] : []),
    ],
    at: partner.savedAt,
  };
}

// What a follow brings, per type of company: the follower digest lists the new vacancies of an employer; a recruitment or
// staffing company publishes nothing that is followed yet, so its row promises no news.
const followNews: Record<OrganizationType, string> = {
  employer: "You hear about its new vacancies, at most once a day.",
  recruitment_company: "Its profile stays at hand here.",
  staffing_company: "Its profile stays at hand here.",
};

// A followed company links to its company page (an employer) or its partner profile.
export function followedCompanyItem(lang: string, company: FollowedCompany): ConnectionItem {
  return {
    id: company.id,
    name: company.displayName,
    href:
      company.organizationType === "employer" ? companyPagePath(lang, company.slug) : partnerProfilePath(lang, company.slug),
    details: [`${typeLabels[company.organizationType]}, based in ${company.basedIn}`, followNews[company.organizationType]],
    at: company.followedAt,
  };
}
