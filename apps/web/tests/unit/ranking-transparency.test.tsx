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
  freshListing,
  listedAndVisible,
  partnerProfileTime,
  partnerSearchExclusions,
  partnerSearchOrderBy,
  rankingCopy,
  rankingFilters,
} from "@/lib/partners/ranking";
import { matchedFilterNames } from "@/lib/partners/search-params";
import { RANKING_PATH, releasedPagePaths } from "@/lib/public/navigation";
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

// The start of a create function statement for public.<name>, in any case and spacing, names quoted or not.
const createFunction = (name: string) => new RegExp(String.raw`create\s+(or\s+replace\s+)?function\s+"?public"?\."?${name}"?\s*\(`, "i");

// The body of the function as the last migration that creates it defines it, whitespace collapsed.
function latestDefinition(name: string): string {
  const migrations = new URL("../../../../supabase/migrations/", import.meta.url);
  const start = createFunction(name);
  const file = readdirSync(migrations)
    .filter((entry) => entry.endsWith(".sql"))
    .sort()
    .map((entry) => readFileSync(new URL(entry, migrations), "utf8"))
    .filter((sql) => start.test(sql))
    .at(-1);
  if (file === undefined) throw new Error(`No migration creates public.${name}`);
  const from = file.slice(file.search(start));
  const body = from.indexOf("$$");
  return squash(from.slice(body, from.indexOf("$$;", body + 2)));
}

const searchPartners = latestDefinition("search_partners");
const clause = (body: string, pattern: RegExp) => pattern.exec(body)?.[1] ?? "";
const availableWorkforce = latestDefinition("search_available_workforce");

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
