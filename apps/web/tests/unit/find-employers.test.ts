import { beforeEach, describe, expect, it, vi } from "vitest";
import { anonymousJobOrderText, savedSearchText } from "@/lib/find-employers/presentation";
import { findEmployersFormDefaults, findEmployersQuery, parseFindEmployersParams } from "@/lib/find-employers/search-params";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { getEmployerSearchAccess, searchEmployers } = await import("@/lib/dal/find-employers");

const CURSOR = "11111111-1111-4111-8111-111111111111";
const order = {
  id: "22222222-2222-4222-8222-222222222222", eligible: true, reasons: [], title: "Germany, 100 Welders and flame cutters",
  country_code: "DE", workers_needed: 100, industry_code: "C", published_on: "2026-11-10",
};
const anonymous = {
  kind: "job_order", employer_id: null, display_name: null, slug: null, website: null, based_in_country: null, industry_code: null,
  open_vacancy_count: null, job_order_count: 1, job_orders: [order], next_cursor: null,
};
const company = {
  kind: "company", employer_id: "33333333-3333-4333-8333-333333333333", display_name: "Acme Bau", slug: "acme-bau",
  website: "https://acme.example", based_in_country: "DE", industry_code: "F", open_vacancy_count: 3, job_order_count: 0,
  job_orders: [], next_cursor: CURSOR,
};
const names = {
  countries: new Map([["DE", "Germany"]]),
  industries: new Map([["C", "Manufacturing"]]),
  occupations: new Map([["7212", "Welders and flame cutters"]]),
};

beforeEach(() => vi.clearAllMocks());

describe("the address of Find Employers (FR-L3 AC9)", () => {
  it("reads the four filters, drops and names a value that does not parse, and writes them back", () => {
    const { filters, errors } = parseFindEmployersParams({ destination: "de", industry: "c", occupation: "72", min_workers: "0", limit: "500", verified: "1" });
    expect(filters).toEqual({ destination: "DE", industry: "C", occupation: undefined, min_workers: undefined, limit: 50 });
    expect(Object.keys(errors).sort()).toEqual(["min_workers", "occupation"]);
    expect(findEmployersQuery({ destination: "DE", occupation: "7212", min_workers: 50, cursor: CURSOR, limit: 20 })).toBe(
      `destination=DE&occupation=7212&min_workers=50&cursor=${CURSOR}`,
    );
  });

  it("refuses a page link that is not an id and fills the form without the cursor", () => {
    expect(parseFindEmployersParams({ cursor: "nope" }).errors.cursor).toBe("The page link is not valid, so the first page is shown.");
    expect(findEmployersFormDefaults(`destination=DE&min_workers=100001&cursor=${CURSOR}`)).toEqual({
      destination: "DE", industry: "", occupation: "", min_workers: "",
    });
  });
});

describe("the words of a result (FR-L3 AC7)", () => {
  it("puts the industry before the neutral title of a job order whose employer is not named", () => {
    expect(anonymousJobOrderText(order.title, "C", names)).toBe("Manufacturing, Germany, 100 Welders and flame cutters");
    expect(anonymousJobOrderText("France, 20 Welders and flame cutters", null, names)).toBe("France, 20 Welders and flame cutters");
  });

  it("names the filters of a saved search", () => {
    expect(savedSearchText({ id: "s", destination: "DE", industry: null, occupation: "7212", minWorkers: 50 }, names)).toBe(
      "Germany · 7212 Welders and flame cutters · at least 50 workers",
    );
  });
});

describe("searchEmployers", () => {
  it("keeps a job order whose employer is not named apart from the companies, with no employer field", async () => {
    rpcMock.mockResolvedValueOnce({ data: [anonymous, company], error: null });
    const result = await searchEmployers("org-1", { limit: 20 });
    expect(result).toMatchObject({ state: "found", nextCursor: CURSOR, cursorIgnored: false });
    if (result.state !== "found") throw new Error("not found");
    expect(result.results[0]).toEqual({
      kind: "job_order",
      jobOrder: { id: order.id, eligible: true, reasons: [], title: order.title, countryCode: "DE", workersNeeded: 100, industryCode: "C", publishedOn: "2026-11-10" },
    });
    expect(result.results[1]).toMatchObject({ kind: "company", displayName: "Acme Bau", slug: "acme-bau", openVacancyCount: 3, jobOrders: [] });
  });

  it("shows the first page, marked, when the page link names no result", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: { message: "CHARA_INVALID_INPUT", details: "p_cursor" } })
      .mockResolvedValueOnce({ data: [company], error: null });
    expect(await searchEmployers("org-1", { cursor: CURSOR, limit: 20 })).toMatchObject({ state: "found", cursorIgnored: true });
    expect(rpcMock).toHaveBeenNthCalledWith(2, "search_employers", expect.objectContaining({ p_cursor: undefined }));
  });

  it("answers the refusals as states and fails on anything else", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "CHARA_FEATURE_NOT_IN_PLAN", details: "employer_discovery" } });
    expect(await searchEmployers("org-1", { limit: 20 })).toEqual({ state: "refused", reason: "plan_required" });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "CHARA_FEATURE_NOT_IN_PLAN", details: "advanced_employer_discovery" } });
    expect(await searchEmployers("org-1", { occupation: "7212", limit: 20 })).toEqual({ state: "advanced_required" });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "CHARA_RATE_LIMITED", details: null } });
    expect(await searchEmployers("org-1", { limit: 20 })).toEqual({ state: "rate_limited" });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "CHARA_FORBIDDEN", details: "not_listed" } });
    expect(await searchEmployers("org-1", { limit: 20 })).toEqual({ state: "refused", reason: "not_listed" });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "CHARA_INVALID_INPUT", details: "p_industry" } });
    await expect(searchEmployers("org-1", { limit: 20 })).rejects.toThrow("The employers could not be loaded");
  });
});

describe("getEmployerSearchAccess (FR-L3 AC8, AC9)", () => {
  it("tells the page whether the advanced filters are open, or why the company cannot search", async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    expect(await getEmployerSearchAccess("org-1")).toEqual({ state: "allowed", advanced: false });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "CHARA_FEATURE_NOT_IN_PLAN", details: "employer_discovery" } });
    expect(await getEmployerSearchAccess("org-1")).toEqual({ state: "refused", reason: "plan_required" });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "CHARA_NOT_FOUND", details: null } });
    await expect(getEmployerSearchAccess("org-1")).rejects.toThrow("Find Employers could not be loaded");
  });
});
