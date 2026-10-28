import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { listJobOrders } = await import("@/lib/dal/job-orders");

const CURSOR = "11111111-1111-4111-8111-111111111111";
const row = {
  id: "22222222-2222-4222-8222-222222222222", eligible: false, reasons: ["served_country_missing"], title: "Iceland, 10 Welders",
  country_code: "IS", workers_needed: 10, countries: null, city_region: null, industry_code: null, occupations: null, start_date: null,
  employment_type: null, recruitment_preference: null, published_on: null, response_count: null, responses_fewer_than: null,
  employer_name: null, employer_company_slug: null, next_cursor: null,
};

beforeEach(() => vi.clearAllMocks());

describe("listJobOrders", () => {
  it("shows the first page, marked, when the page link names no job order", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: { message: "CHARA_INVALID_INPUT", details: "p_cursor" } })
      .mockResolvedValueOnce({ data: [row], error: null });
    const result = await listJobOrders("org-1", { destination: "IS", cursor: CURSOR, limit: 20 });
    expect(result).toMatchObject({ state: "found", cursorIgnored: true, nextCursor: null });
    expect(rpcMock).toHaveBeenNthCalledWith(1, "list_job_orders", expect.objectContaining({ p_cursor: CURSOR, p_destination: "IS" }));
    expect(rpcMock).toHaveBeenNthCalledWith(2, "list_job_orders", expect.objectContaining({ p_cursor: undefined, p_destination: "IS" }));
  });

  it("fails on any other invalid input, and answers the refusals of a company as states", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "CHARA_INVALID_INPUT", details: "p_workers_min" } });
    await expect(listJobOrders("org-1", { limit: 20 })).rejects.toThrow("The job orders could not be loaded");
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "CHARA_FORBIDDEN", details: "not_listed" } });
    expect(await listJobOrders("org-1", { limit: 20 })).toEqual({ state: "refused", reason: "not_listed" });
    rpcMock.mockResolvedValueOnce({ data: [row], error: null });
    expect(await listJobOrders("org-1", { limit: 20 })).toMatchObject({ state: "found", cursorIgnored: false });
  });
});
