import { matchedFilterLabels, matchedFilterNames, type MatchedFilter } from "@/lib/partners/search-params";
import { suggestionPlanDisclosure } from "@/lib/requirements/suggestions";

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
    "Capacity and timeframe (both directories) and more than one source country (Find Recruitment Partners only) are advanced filters, available to a signed-in organisation whose plan includes them.",
  size: "Company size (its workforce size band) counts only through the workforce size filter, when you choose it. The number of workers a company lists as available counts only in the capacity filter and in the available workforce search, as described above.",
  payment:
    "whether a company pays, which plan it is on and how much it pays are not read by any of these searches. Nobody can pay for a higher place.",
  // Availability listings are added within the workforce_listings allowance of the partner's plan (billing.plan_limits);
  // worded without plan names so that it stays true when the allowances change.
  listings:
    "Availability listings, which the capacity and timeframe filters and the available workforce search use, can be added only within the allowance of the company's plan, so the plan decides how many listings a company can have.",
} as const;

// The partner suggestions for a workforce requirement as public.suggest_partners builds them (FR-M3, V36). The page
// describes them while release 2b is on; tests/unit/ranking-transparency.test.tsx holds these values against the latest
// definition of the function.
export const suggestionOrderBy = "order by cardinality(j.met) desc, j.updated_at desc, j.id";

// Who is suggested: the partners shown in Find Partners (listedAndVisible) of the types the requirement asks for, serving
// one of its destinations and listing one of its occupations.
export const suggestionSelection = [
  "select 1 from public.organization_geographies g where g.organization_id = o.id and g.scope = 'serves_market' and g.country_code = any (v_destinations)",
  "select 1 from public.organization_occupations oo where oo.organization_id = o.id and oo.occupation_id = any (v_occupations)",
  "where (v_row.partner_need in ('recruitment', 'both') and s.type = 'recruitment_company') or (v_row.partner_need in ('staffing', 'both') and (s.type = 'staffing_company' or s.staffing_service))",
] as const;

// What each criterion means, in the order a suggestion names them (lib/requirements/suggestions.ts suggestionCriteria).
export const suggestionCriterionTexts = {
  industry: "the company lists the industry of the requirement on its profile.",
  recruitment_type:
    "the company offers the type of recruitment the requirement asks for, local or international; a company or a requirement that names both counts for either.",
  capacity:
    "for every occupation of the requirement, the company's current availability listings of that occupation, added up over the countries it sources from, hold at least the number of workers the requirement needs for it.",
  available_before_start:
    "for every occupation of the requirement, the company's current listings whose workers are available on or before the start date hold at least the number of workers needed.",
} as const;

export const suggestionCopy = {
  selection:
    "An employer who needs partners for a workforce requirement can see suggested partners. A company is suggested only when it would be shown in the directories (see Which companies are shown), is of a type the requirement asks for (recruitment companies for recruitment; staffing companies and recruitment companies that also offer staffing for staffing; all of them for both), serves at least one of the requirement's destination countries and lists at least one of its occupations.",
  explain:
    "Each suggestion names the criteria it meets and those it does not, and the facts behind them. Every criterion weighs the same. A suggestion is not a score and says nothing about the quality of a company; companies are not told that they were suggested.",
  // P2B Regulation article 5(3) (decided, user delegated): the same sentence as the suggestions page, lib/requirements/suggestions.ts.
  disclosure: suggestionPlanDisclosure,
  size: "In the partner suggestions it counts only in the capacity and start date criteria, as described above.",
  limit:
    "A limited number of suggestions is shown, with links to the directories when more companies fit; the limit does not change the order.",
} as const;

// The job orders of the marketplace as public.list_job_orders lists them (FR-N1, V39). The page describes them while
// release 2b is on; tests/unit/ranking-transparency.test.tsx holds the order against the latest definition of the function.
export const jobOrderOrderBy = "order by r.published_at desc, r.id limit v_limit + 1";

// The conditions under which a job order is listed, as the function writes them.
export const jobOrderSelection =
  "where r.status = 'open' and r.visibility = 'job_order_marketplace' and e.status = 'active' and r.moderation_state = 'visible'";

// The refusals of private.assert_job_order_partner, which every read of the board and of a job order makes first (V79):
// only a listed, active and visible recruitment or staffing company sees job orders.
export const jobOrderAccessChecks = ["partner_only", "organization_suspended", "not_listed", "profile_hidden"] as const;

export const jobOrderCopy = {
  selection:
    "Listed recruitment and staffing companies see the job orders of the marketplace: the workforce requirements that employers published to it, while they are open (not paused, closed or filled), not hidden by moderation, and the employer's account is active.",
  access:
    "Only a recruitment or staffing company that is listed in the directories, active and not hidden by moderation can open the job orders; the check is made again for every page of results and every job order.",
  details:
    "Every listed company sees every job order, in the same order. It sees the full job order when it serves one of the job order's destination countries, lists one of its occupations and its plan includes job orders; otherwise it sees only the title, the destination and the number of workers, with what it is missing. This decides how much a company sees, never the order.",
  filters: "With a filter on a detail a company cannot see, only the job orders it sees in full are listed.",
  named:
    "Whether the employer shows its name on a job order, or has revealed it to a company by inviting, shortlisting or selecting it, decides only what that company reads, never the order.",
  payment: "No employer can pay to place a job order higher, and the plan of the company looking never changes the order.",
  paging:
    "Job orders come 20 per page by default, with a link to the next page, and the number of requests per person is limited to prevent scraping; neither changes the order.",
} as const;

// Find Employers as public.search_employers orders it (FR-L3, V53). The page describes it while release 2b is on;
// tests/unit/ranking-transparency.test.tsx holds the order against the latest definition of the function.
export const findEmployersOrderBy = "order by r.sort_at desc nulls last, r.id";

// The employers a company row may show, as the function writes them.
export const findEmployersSelection = "where e.type = 'employer' and e.status = 'active'";

export const findEmployersCopy = {
  selection:
    "Listed recruitment and staffing companies on a paid partner plan can find employers: employers whose company page is public, and employers named on an open job order the company sees. A job order whose employer chose not to be named is listed on its own, never next to the employer.",
  order:
    "The latest activity of each result comes first: for an employer, the newest publication of a job order or of a vacancy on its public page; for a job order listed on its own, its publication.",
  payment: "No employer can pay to appear higher, and the plan of the company searching decides only which filters it can use, never the order.",
  paging:
    "Results come 20 per page by default, with a link to the next page, and the number of searches per company is limited to prevent scraping; neither changes the order.",
} as const;

// Find Workers as public.search_workers orders it (FR-Q2, V69). The page describes it while release 2c is on;
// tests/unit/ranking-transparency.test.tsx holds the order and the selection against the latest definition of the function.
export const findWorkersOrderBy = "order by r.score desc, r.updated_at desc, r.card_id";

// Which cards are searched: the listed ones (opted in, account active, no deletion requested; V68).
export const findWorkersSelection = "where c.listed";

export const findWorkersCopy = {
  selection:
    "Employers, and listed recruitment and staffing companies, on a paid plan can search the workers who chose to be found. Only workers whose choice is current and whose account is active are shown; every filter leaves out the workers that do not match it.",
  score:
    "The match score: one point for each field your keyword is found in (the occupation, the headline, the skills), and one point for each of the skills you chose that the worker lists. Without a keyword or skills, every worker scores the same.",
  updated:
    "The last time the worker changed a field their card shows, most recent first.",
  identifier: "A fixed random number of each card, so that cards equal on everything above always appear in the same order.",
  rules:
    "The direct-hiring rules of the worker's country for your destination decide only whether a card offers direct contact or points to recruitment partners, never whether or where it is listed.",
  never:
    "No characteristic such as gender, age, nationality, religion or health is a filter or counts in the order. Whether your organisation pays, and its plan, decide only which filters it can use, never the order; workers never pay.",
  paging:
    "Results come 20 per page by default, with a link to the next page, and the number of searches per person is limited to prevent scraping; neither changes the order.",
} as const;

