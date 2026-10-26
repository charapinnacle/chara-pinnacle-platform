import { matchedFilterLabels, matchedFilterNames, type MatchedFilter } from "@/lib/partners/search-params";

// The ranking of Find Partners as public.search_partners and public.search_available_workforce build it (V21, V22). The
// public page /[lang]/legal/ranking (NFR-C8) is written from these values, and tests/unit/ranking-transparency.test.tsx
// fails when the latest definition of either function in supabase/migrations no longer contains them: a change of the
// order, the visibility conditions or the filters changes this file and the page in the same pull request.

export const partnerSearchOrderBy = "order by cardinality(m.matched) desc, m.updated_at desc, m.id";
export const partnerProfileTime = "coalesce(o.workforce_profile_updated_at, o.listed_at) as updated_at";
export const availableWorkforceOrderBy = "order by r.covers desc, r.confirmed_at desc, r.organization_id";
export const availableWorkforceCovers = "(f.available_now >= p_workers_needed)::integer as covers";
export const availableWorkforceSupply =
  "a.available + floor(a.monthly_capacity * (v_by - greatest(v_today, a.available_from))::numeric / 30)::integer as supply";

// A listing counts in both searches only while it is fresh (confirmed within workforce_listing_stale_days).
export const freshListing = "a.confirmed_at > v_fresh_since";

// Both searches return only the partners that meet every one of these conditions.
export const listedAndVisible = [
  "o.listed_at is not null",
  "o.review_status <> 'declined'",
  "o.status = 'active'",
  "o.moderation_state = 'visible'",
] as const;

// Everything that leaves a partner out, whitespace collapsed: the where clause of the matches CTE of search_partners and
// the where clause of counted and the having clause of fits of search_available_workforce. Nothing else excludes.
export const partnerSearchExclusions =
  "where ( (p_kind = 'recruitment' and o.type = 'recruitment_company') or (p_kind = 'staffing' and (o.type = 'staffing_company' or (o.type = 'recruitment_company' and exists ( select 1 from public.organization_service_types st where st.organization_id = o.id and st.service = 'staffing' )))) ) and o.listed_at is not null and o.review_status <> 'declined' and o.status = 'active' and o.moderation_state = 'visible' and (v_destination is null or exists ( select 1 from public.organization_geographies g where g.organization_id = o.id and g.scope = 'serves_market' and g.country_code = v_destination )) and (p_occupation is null or exists ( select 1 from public.organization_occupations oo where oo.organization_id = o.id and oo.occupation_id = p_occupation ))";
export const availableWorkforceExclusions =
  "where a.occupation_id = p_occupation and a.confirmed_at > v_fresh_since and a.available_from <= v_by and o.type <> 'employer' and o.listed_at is not null and o.review_status <> 'declined' and o.status = 'active' and o.moderation_state = 'visible' and exists ( select 1 from public.organization_geographies g where g.organization_id = o.id and g.scope = 'serves_market' and g.country_code = v_destination )";
export const availableWorkforceHaving = "having sum(c.supply) >= p_workers_needed";

// The filters that leave out the partners that do not match; every result matches them, so they count the same for all.
export const narrowingFilters = ["destination", "occupation"] as const satisfies readonly MatchedFilter[];

type RankingFilter = Exclude<MatchedFilter, (typeof narrowingFilters)[number]>;

// The advanced filters, which need the feature of this name in a plan of the searching organisation.
export const advancedPartnerSearchFeature = "advanced_partner_search";
export const advancedFilters = ["capacity", "timeframe"] as const satisfies readonly RankingFilter[];

export type PartnerDirectory = "recruitment" | "staffing";

export const directoryNames: Record<PartnerDirectory, string> = {
  recruitment: "Find Recruitment Partners",
  staffing: "Find Staffing Partners",
};

// What each ranking filter means, the directories whose search form offers it (components/partners/partner-search-form.tsx)
// and the label of the form where it differs from the name on a result card.
const rankingFilterDetails: Record<RankingFilter, { text: string; directories: readonly PartnerDirectory[]; formLabel?: string }> = {
  based_in: { text: "the company is based in the country you chose.", directories: ["recruitment", "staffing"] },
  sources_from: {
    text: "the company lists at least one of the source countries you chose as a country it recruits from.",
    directories: ["recruitment"],
    formLabel: "Sources workers from",
  },
  industry: { text: "the company lists the industry you chose on its profile.", directories: ["recruitment", "staffing"] },
  language: { text: "the company lists the language you chose on its profile.", directories: ["recruitment"] },
  recruitment_type: {
    text: "the company offers the type of recruitment you chose, local or international; a company that offers both matches either.",
    directories: ["recruitment"],
  },
  staffing_type: { text: "the company offers at least one of the staffing types you chose.", directories: ["staffing"] },
  workforce_size: { text: "the company's workforce is in the size band you chose.", directories: ["staffing"] },
  capacity: {
    text: "the company has a current availability listing (of the occupation you chose, if you chose one) with at least the number of workers you entered.",
    directories: ["recruitment", "staffing"],
    formLabel: "Workers available, at least",
  },
  timeframe: {
    text: "the company has a current availability listing (of the occupation you chose, if you chose one) whose workers are available within the number of days you entered. With capacity as well, one listing must meet both.",
    directories: ["recruitment", "staffing"],
    formLabel: "Available within (days)",
  },
};

const isRankingFilter = (name: MatchedFilter): name is RankingFilter => !(narrowingFilters as readonly string[]).includes(name);

// The filters that only rank, in the order search_partners names them on a result card.
export const rankingFilters = matchedFilterNames.filter(isRankingFilter).map((name) => ({
  name,
  label: matchedFilterLabels[name],
  ...rankingFilterDetails[name],
  advanced: (advancedFilters as readonly string[]).includes(name),
}));

// The sentences of the page that are not lists of the filters.
export const rankingCopy = {
  narrowing:
    "Destination (Destination country in the form): only companies that serve the destination country you chose are shown. Occupation: only companies that list the occupation you chose are shown. Both directories offer both filters.",
  weighting:
    "Each parameter only decides between companies that are equal on the ones before it. Every matched filter weighs the same; none counts more than another.",
  tieBreakFirst: "Each parameter only decides between companies that are equal on the ones before it.",
  profileTime: [
    "The last time the company saved one of the following, most recent first:",
    "the countries it serves or recruits from, when the save changed them;",
    "its workforce offer (occupations, industries, languages, services, recruitment type, workforce size), when the save changed it;",
    "an availability listing it added, changed, confirmed or deleted; saving or confirming a listing counts even when nothing in it changed.",
    "Before any of these, the time its profile was listed.",
  ],
  identifier: "A fixed random number given to each company when it joined, so that companies equal on everything above always appear in the same order.",
  supplyExample: "For example, a listing of 120 workers available now and 40 a month, needed within 60 days, adds 120 + 40 × 60 / 30 = 200.",
  paging:
    "Results come 20 per page by default, with a link to the next page, and searches are limited in number per person and per visitor to prevent scraping; neither changes the order.",
  advanced:
    "Capacity and timeframe (both directories) and more than one source country (Find Recruitment Partners only) are advanced filters, available to an organisation whose plan includes them.",
  size: "Company size (its workforce size band) counts only through the workforce size filter, when you choose it. The number of workers a company lists as available counts only in the capacity filter and in the available workforce search, as described above.",
} as const;
