import { readdirSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  advancedPartnerSearchFeature,
  availableWorkforceCovers,
  availableWorkforceExclusions,
  availableWorkforceHaving,
  availableWorkforceOrderBy,
  availableWorkforceSupply,
  findEmployersCopy,
  findEmployersOrderBy,
  findEmployersSelection,
  freshListing,
  jobOrderAccessChecks,
  jobOrderCopy,
  jobOrderOrderBy,
  jobOrderSelection,
  listedAndVisible,
  partnerProfileTime,
  partnerSearchExclusions,
  partnerSearchOrderBy,
  rankingCopy,
  rankingFilters,
  suggestionCopy,
  suggestionCriterionTexts,
  suggestionOrderBy,
  suggestionSelection,
} from "@/lib/partners/ranking";
import { matchedFilterNames } from "@/lib/partners/search-params";
import { RANKING_PATH, releasedPagePaths } from "@/lib/public/navigation";
import { suggestionCriteria } from "@/lib/requirements/suggestions";
import { sitemapEntries } from "@/lib/seo/sitemap";

const isReleased = vi.hoisted(() => vi.fn());
const getAvailabilityRules = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased }));
vi.mock("@/lib/dal/workforce-availability", () => ({ getAvailabilityRules }));

const { default: RankingPage } = await import("@/app/[lang]/(public)/legal/ranking/page");

const squash = (text: string) => text.replace(/\s+/g, " ");

// The start of a create function statement for <schema>.<name>, in any case and spacing, names quoted or not.
const createFunction = (name: string, schema = "public") =>
  new RegExp(String.raw`create\s+(or\s+replace\s+)?function\s+"?${schema}"?\."?${name}"?\s*\(`, "i");

// The body of the function as the last migration that creates it defines it, whitespace collapsed.
function latestDefinition(name: string, schema = "public"): string {
  const migrations = new URL("../../../../supabase/migrations/", import.meta.url);
  const start = createFunction(name, schema);
  const file = readdirSync(migrations)
    .filter((entry) => entry.endsWith(".sql"))
    .sort()
    .map((entry) => readFileSync(new URL(entry, migrations), "utf8"))
    .filter((sql) => start.test(sql))
    .at(-1);
  if (file === undefined) throw new Error(`No migration creates ${schema}.${name}`);
  const from = file.slice(file.search(start));
  const body = from.indexOf("$$");
  return squash(from.slice(body, from.indexOf("$$;", body + 2)));
}

const searchPartners = latestDefinition("search_partners");
const clause = (body: string, pattern: RegExp) => pattern.exec(body)?.[1] ?? "";
const availableWorkforce = latestDefinition("search_available_workforce");
const suggestPartners = latestDefinition("suggest_partners");
const listJobOrders = latestDefinition("list_job_orders");
const searchEmployers = latestDefinition("search_employers");
const assertJobOrderPartner = latestDefinition("assert_job_order_partner", "private");

async function renderPage(): Promise<string> {
  const page = await RankingPage({ params: Promise.resolve({ lang: "en" }) } as Parameters<typeof RankingPage>[0]);
  return squash(renderToStaticMarkup(page).replace(/<[^>]*>/g, " ").replaceAll("&#x27;", "'"));
}

beforeEach(() => {
  isReleased.mockResolvedValue(true);
  getAvailabilityRules.mockResolvedValue({ staleDays: 60, reminderDays: 50, maxDays: 365 });
});

// NFR-C8: the page says what the searches do. Each test fails when the SQL changes and lib/partners/ranking.ts does not.
describe("the ranking page and the search functions (NFR-C8)", () => {
  it("finds a create function statement however it is cased, spaced or quoted", () => {
    for (const sql of [
      "create function public.search_partners(",
      'CREATE OR REPLACE FUNCTION "public"."search_partners" (',
      "create  or\n  replace function public.\"search_partners\"(",
    ]) {
      expect(createFunction("search_partners").test(sql), sql).toBe(true);
    }
    expect(createFunction("search_partners").test("create function public.search_partners_other(")).toBe(false);
  });

  it("nothing but the conditions the page describes leaves a company out", () => {
    expect(clause(searchPartners, /\) listing on true (where .*?) \), page as \(/)).toBe(partnerSearchExclusions);
    expect(clause(availableWorkforce, /join public\.organizations o on o\.id = a\.organization_id (where .*?) \), fits as \(/)).toBe(
      availableWorkforceExclusions,
    );
    expect(clause(availableWorkforce, /group by c\.organization_id (having .*?) \), ranked as \(/)).toBe(availableWorkforceHaving);
  });

  it("search_partners orders by the matched filters, the profile time and the id", () => {
    expect(searchPartners).toContain(partnerSearchOrderBy);
    expect(searchPartners).toContain(partnerProfileTime);
  });

  it("search_partners names its matched filters in the order and with the names the page lists", () => {
    const matched = /array_remove\(array\[(.*?)\], null\) as matched/.exec(searchPartners)?.[1] ?? "";
    expect([...matched.matchAll(/then '([a-z_]+)' end/g)].map((match) => match[1])).toEqual([...matchedFilterNames]);
    expect(rankingFilters.map(({ name }) => name)).toEqual(matchedFilterNames.filter((name) => name !== "destination" && name !== "occupation"));
  });

  it("search_partners leaves out only the companies that miss the destination or the occupation", () => {
    expect(searchPartners).toContain("and (v_destination is null or exists ( select 1 from public.organization_geographies g");
    expect(searchPartners).toContain("and (p_occupation is null or exists ( select 1 from public.organization_occupations oo");
  });

  it("search_partners asks a visitor to sign in for capacity, timeframe and several source countries, refuses them without the advanced feature, and orders nothing by it", () => {
    expect(searchPartners).toContain("v_listing_filter boolean := p_capacity is not null or p_within_days is not null;");
    expect(searchPartners).toContain(
      `if v_listing_filter or cardinality(v_sources) > 1 then if v_uid is null then raise exception 'CHARA_UNAUTHENTICATED' using detail = '${advancedPartnerSearchFeature}'; end if; if not exists ( select 1 from private.member_org_ids() m (organization_id) where private.has_feature(m.organization_id, '${advancedPartnerSearchFeature}') ) then raise exception 'CHARA_FEATURE_NOT_IN_PLAN'`,
    );
    expect(searchPartners.match(/has_feature/g)).toHaveLength(1);
    expect(rankingFilters.filter(({ advanced }) => advanced).map(({ name }) => name)).toEqual(["capacity", "timeframe"]);
  });

  it("search_available_workforce orders by cover now, the latest confirmation and the id, with the supply the page explains", () => {
    expect(availableWorkforce).toContain(availableWorkforceOrderBy);
    expect(availableWorkforce).toContain(availableWorkforceCovers);
    expect(availableWorkforce).toContain(availableWorkforceSupply);
    expect(availableWorkforce).toContain("max(c.confirmed_at) as confirmed_at");
  });

  it("both searches show only listed, not declined, active and visible companies, and only fresh listings", () => {
    for (const body of [searchPartners, availableWorkforce]) {
      for (const condition of listedAndVisible) expect(body).toContain(condition);
      expect(body).toContain(freshListing);
    }
  });

  it("neither search reads billing, a subscription or a plan", () => {
    for (const body of [searchPartners, availableWorkforce]) {
      expect(body).not.toMatch(/\b(billing|subscriptions?|plan_code|plans)\b/i);
    }
  });
});

// FR-M3: the page says what the partner suggestions do; each test fails when suggest_partners changes alone.
describe("the ranking page and the partner suggestions (FR-M3, NFR-C8)", () => {
  it("suggest_partners orders by the criteria met, the profile time and the id", () => {
    expect(suggestPartners).toContain(suggestionOrderBy);
    expect(suggestPartners).toContain(partnerProfileTime);
  });

  it("suggest_partners names its criteria in the order and with the names the page lists", () => {
    const met = /array_remove\(array\[(.*?)\], null\) as met/.exec(suggestPartners)?.[1] ?? "";
    expect([...met.matchAll(/then '([a-z_]+)' end/g)].map((match) => match[1])).toEqual([...suggestionCriteria]);
    expect(Object.keys(suggestionCriterionTexts)).toEqual([...suggestionCriteria]);
  });

  it("suggest_partners selects the listed, visible partners of the requested types, destinations and occupations, with fresh listings", () => {
    for (const condition of listedAndVisible) expect(suggestPartners).toContain(condition);
    for (const condition of suggestionSelection) expect(suggestPartners).toContain(condition);
    expect(suggestPartners).toContain("a.confirmed_at > v_fresh_since");
  });

  it("suggest_partners reads no billing, subscription or plan", () => {
    expect(suggestPartners).not.toMatch(/\b(billing|subscriptions?|plan_code|plans|has_feature)\b/i);
  });

  it("discloses that two criteria use listings, which plans allow, without naming a plan (P2B article 5(3))", () => {
    const plans = readFileSync(new URL("../../../../supabase/seeds/ref/plans.sql", import.meta.url), "utf8");
    const planNames = [...plans.matchAll(/'((?:recruitment|staffing)_[a-z]+|free_[a-z_]+)'/g)].map((match) => match[1]);
    expect(planNames.length).toBeGreaterThan(0);
    for (const text of [suggestionCopy.disclosure, rankingCopy.listings, rankingCopy.payment]) {
      for (const name of planNames) expect(text).not.toContain(name);
      expect(text).not.toMatch(/\b(Basic|Professional|Enterprise|Free)\b/);
    }
    expect(suggestionCopy.disclosure).toContain("within the allowance of a partner's plan");
    expect(rankingCopy.listings).toContain("within the allowance of the company's plan");
    // The allowance is billing.plan_limits workforce_listings, and some partner plans allow none: the text must not say
    // that plans play no part.
    const migrations = new URL("../../../../supabase/migrations/", import.meta.url);
    const limits = readdirSync(migrations)
      .map((entry) => readFileSync(new URL(entry, migrations), "utf8"))
      .join("\n");
    expect(limits).toMatch(/'workforce_listings', 0\)/);
    for (const text of [suggestionCopy.disclosure, suggestionCopy.explain, rankingCopy.payment]) {
      expect(text).not.toMatch(/plan (does not|never) (matter|count)|no partner pays|regardless of plan/i);
    }
  });

  it("the page describes the suggestions only while release 2b is on", async () => {
    isReleased.mockImplementation((key: string) => Promise.resolve(key !== "release_job_orders"));
    expect(await renderPage()).not.toContain("Partner suggestions for a workforce requirement");
    isReleased.mockResolvedValue(true);
    const text = await renderPage();
    expect(text).toContain("Partner suggestions for a workforce requirement");
    for (const line of Object.values(suggestionCopy)) expect(text).toContain(squash(line));
    for (const rule of Object.values(suggestionCriterionTexts)) expect(text).toContain(rule);
    expect(text).toContain("Available before start: for every occupation of the requirement");
    expect(text).toContain(`Size: ${squash(rankingCopy.size)} ${suggestionCopy.size}`);
    expect(text).toContain("The number of criteria the company meets, most first.");
  });
});

// FR-N1: the page says how the job orders are ordered; each test fails when list_job_orders changes alone.
describe("the ranking page and the job orders (FR-N1, NFR-C8)", () => {
  it("list_job_orders lists the open marketplace job orders of active employers, newest first, then by id", () => {
    expect(listJobOrders).toContain(jobOrderSelection);
    expect(listJobOrders).toContain(jobOrderOrderBy);
  });

  it("only a listed, active and visible partner opens the board, as the page says", () => {
    expect(listJobOrders).toContain("perform private.assert_job_order_partner(p_org);");
    for (const detail of jobOrderAccessChecks) expect(assertJobOrderPartner).toContain(`detail = '${detail}'`);
    expect(jobOrderSelection).toContain("r.moderation_state = 'visible'");
    expect(jobOrderCopy.selection).toContain("not hidden by moderation");
    expect(jobOrderCopy.access).toContain("listed in the directories, active and not hidden by moderation");
  });

  it("no order by of list_job_orders reads the employer's name or a reveal", () => {
    const orders = [...listJobOrders.matchAll(/order by [^;]*?(?=\)|;|limit|$)/g)].map((match) => match[0]);
    for (const order of orders) expect(order).not.toMatch(/\b(show_identity|revealed|named|reveals?|display_name)\b/i);
  });

  it("no order by of list_job_orders reads a plan", () => {
    const orders = [...listJobOrders.matchAll(/order by [^;]*?(?=\)|;|limit|$)/g)].map((match) => match[0]);
    expect(orders.length).toBeGreaterThan(0);
    for (const order of orders) expect(order).not.toMatch(/\b(billing|subscriptions?|plan_code|plans|has_feature|paid)\b/i);
  });

  it("names no plan and does not say plans play no part in what a company sees", () => {
    for (const text of Object.values(jobOrderCopy)) expect(text).not.toMatch(/\b(Basic|Professional|Enterprise|Free)\b/);
    expect(jobOrderCopy.details).toContain("its plan includes job orders");
  });

  it("the page describes the job orders only while release 2b is on", async () => {
    isReleased.mockImplementation((key: string) => Promise.resolve(key !== "release_job_orders"));
    expect(await renderPage()).not.toContain("Job orders are sorted by these parameters");
    isReleased.mockResolvedValue(true);
    const text = await renderPage();
    for (const line of Object.values(jobOrderCopy)) expect(text).toContain(squash(line));
    expect(text).toContain("The time the employer published the job order, newest first.");
    expect(text).toContain("and the order of their Find Employers results");
  });
});

// FR-L3: the page says how Find Employers orders its results; each test fails when search_employers changes alone.
describe("the ranking page and Find Employers (FR-L3, NFR-C8)", () => {
  it("search_employers lists active employers, latest activity first, then by id", () => {
    expect(searchEmployers).toContain(findEmployersSelection);
    expect(searchEmployers).toContain(findEmployersOrderBy);
  });

  it("no order by of search_employers reads a plan", () => {
    const orders = [...searchEmployers.matchAll(/order by [^;]*?(?=\)|;|limit|$)/g)].map((match) => match[0]);
    expect(orders.length).toBeGreaterThan(0);
    for (const order of orders) expect(order).not.toMatch(/\b(billing|subscriptions?|plan_code|plans|has_feature|paid)\b/i);
  });

  it("names no plan", () => {
    for (const text of Object.values(findEmployersCopy)) expect(text).not.toMatch(/\b(Basic|Professional|Enterprise|Free)\b/);
  });

  it("the page describes Find Employers only while release 2b is on", async () => {
    isReleased.mockImplementation((key: string) => Promise.resolve(key !== "release_job_orders"));
    expect(await renderPage()).not.toContain(squash(findEmployersCopy.order));
    isReleased.mockResolvedValue(true);
    const text = await renderPage();
    for (const line of Object.values(findEmployersCopy)) expect(text).toContain(squash(line));
  });
});

describe("the ranking page (NFR-C8)", () => {
  it("does not exist while release 2a is off", async () => {
    isReleased.mockResolvedValue(false);
    await expect(renderPage()).rejects.toThrow("NOT_FOUND");
    expect(isReleased).toHaveBeenCalledWith("release_partner_directories");
  });

  it("describes every ranking filter, the order, the freshness period and what never counts", async () => {
    const text = await renderPage();
    for (const { label, formLabel, text: rule } of rankingFilters) {
      const name = `${label.charAt(0).toUpperCase()}${label.slice(1)}${formLabel ? ` (${formLabel} in the form)` : ""}`;
      expect(text).toContain(`${name}: ${rule}`);
    }
    expect(text).toContain("Offered by Find Recruitment Partners.");
    expect(text).toContain("Offered by Find Staffing Partners.");
    expect(text).toContain("Offered by Find Recruitment Partners and Find Staffing Partners.");
    for (const line of rankingCopy.profileTime) expect(text).toContain(line);
    for (const line of [rankingCopy.weighting, rankingCopy.identifier, rankingCopy.supplyExample, rankingCopy.paging, rankingCopy.size]) {
      expect(text).toContain(squash(line));
    }
    expect(text).toContain("confirmed by the company within the last 60 days");
    expect(text).toContain("The number of filters the company matches, most first.");
    expect(text).toContain("Companies whose workers available today already cover the number of workers come first.");
    expect(text).toContain("whether a company pays, which plan it is on and how much it pays are not read by any of these searches");
    expect(text).toContain("never appears, whatever plan it has");
    expect(text).toContain(squash(rankingCopy.payment));
    expect(text).toContain(squash(rankingCopy.listings));
    expect(text).not.toContain("No company can pay to appear higher");
    expect(text).not.toMatch(/verified/i);
  });

  it("is in the sitemap only while release 2a is on", () => {
    expect(releasedPagePaths([])).not.toContain(RANKING_PATH);
    expect(releasedPagePaths(["release_partner_directories"])).toContain(RANKING_PATH);
    const paths = sitemapEntries({
      siteUrl: "https://chara.example",
      lang: "en",
      legalSlugs: [],
      networkPaths: releasedPagePaths(["release_partner_directories"]),
      vacancies: [],
    }).map(({ url }) => new URL(url).pathname);
    expect(paths).toContain("/en/legal/ranking");
  });
});
