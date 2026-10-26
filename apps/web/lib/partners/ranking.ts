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

// The filters that leave out the partners that do not match; every result matches them, so they count the same for all.
export const narrowingFilters = ["destination", "occupation"] as const satisfies readonly MatchedFilter[];

type RankingFilter = Exclude<MatchedFilter, (typeof narrowingFilters)[number]>;

// The advanced filters, which need the feature of this name in a plan of the searching organisation.
export const advancedPartnerSearchFeature = "advanced_partner_search";
export const advancedFilters = ["capacity", "timeframe"] as const satisfies readonly RankingFilter[];

const rankingFilterText: Record<RankingFilter, string> = {
  based_in: "the company is based in the country you chose.",
  sources_from: "the company lists at least one of the source countries you chose as a country it recruits from.",
  industry: "the company lists the industry you chose on its profile.",
  language: "the company lists the language you chose on its profile.",
  recruitment_type: "the company offers the type of recruitment you chose, local or international; a company that offers both matches either.",
  staffing_type: "the company offers at least one of the staffing types you chose.",
  workforce_size: "the company's workforce is in the size band you chose.",
  capacity:
    "the company has a current availability listing (of the occupation you chose, if you chose one) with at least the number of workers you entered.",
  timeframe:
    "the company has a current availability listing (of the occupation you chose, if you chose one) whose workers are available within the number of days you entered. With capacity as well, one listing must meet both.",
};

const isRankingFilter = (name: MatchedFilter): name is RankingFilter => !(narrowingFilters as readonly string[]).includes(name);

// The filters that only rank, in the order search_partners names them on a result card.
export const rankingFilters = matchedFilterNames.filter(isRankingFilter).map((name) => ({
  name,
  label: matchedFilterLabels[name],
  text: rankingFilterText[name],
  advanced: (advancedFilters as readonly string[]).includes(name),
}));
