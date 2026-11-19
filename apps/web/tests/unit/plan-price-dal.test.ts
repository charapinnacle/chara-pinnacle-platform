import { beforeEach, describe, expect, it, vi } from "vitest";

let session: { access_token: string } | null = { access_token: "token-of-the-admin" };
let requestId: string | null = "0b9f4c1e-6a8d-4b7e-9c2f-1d3e5a7b9c0d";
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421" } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(requestId ? { "x-request-id": requestId } : {}) }));
vi.mock("@/lib/env.server", () => ({ serverEnv: () => ({ BILLING_PLAN_PRICE_ENDPOINT: process.env.TEST_ENDPOINT }) }));
vi.mock("@/lib/dal/admin", () => ({ adminClient: vi.fn(), failure: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
}));

const { requestPlanPrice } = await import("@/lib/dal/plan-editor");

const body = { plan_code: "recruitment_partner", price_minor: 5400, reason: "Price review after the first quarter" };

beforeEach(() => {
  session = { access_token: "token-of-the-admin" };
  requestId = "0b9f4c1e-6a8d-4b7e-9c2f-1d3e5a7b9c0d";
  delete process.env.TEST_ENDPOINT;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("requestPlanPrice (FR-R2 AC8)", () => {
  it("forwards the administrator's own token and the change to billing-plan-price", async () => {
    fetchMock.mockResolvedValue(Response.json({ plan_code: "recruitment_partner", price_minor: 5400 }));
    expect(await requestPlanPrice(body)).toEqual({ done: true });
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe("http://127.0.0.1:54421/functions/v1/billing-plan-price");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer token-of-the-admin");
    expect(JSON.parse(init.body)).toEqual(body);
    expect(init.cache).toBe("no-store");
    expect(init.headers["x-request-id"]).toBe("0b9f4c1e-6a8d-4b7e-9c2f-1d3e5a7b9c0d");
  });

  it("sends no request id when the request has none", async () => {
    requestId = null;
    fetchMock.mockResolvedValue(Response.json({ price_minor: 5400 }));
    await requestPlanPrice(body);
    expect("x-request-id" in fetchMock.mock.calls[0][1].headers).toBe(false);
  });

  it("uses the address a deployment names", async () => {
    process.env.TEST_ENDPOINT = "http://127.0.0.1:54436/";
    fetchMock.mockResolvedValue(Response.json({ price_minor: 5400 }));
    await requestPlanPrice(body);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:54436/");
  });

  it("returns the function's refusal, a network failure as status 0, and calls nothing without a session", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "forbidden", reason: "aal2_required" }, { status: 403 }));
    expect(await requestPlanPrice(body)).toEqual({ refusal: { status: 403, reason: "aal2_required", field: null } });
    fetchMock.mockResolvedValueOnce(Response.json({ error: "bad_request", field: "reason" }, { status: 400 }));
    expect(await requestPlanPrice(body)).toEqual({ refusal: { status: 400, reason: null, field: "reason" } });
    fetchMock.mockResolvedValueOnce(Response.json({ price_minor: 4900 }));
    expect(await requestPlanPrice(body)).toEqual({ refusal: { status: 502, reason: null, field: null } });
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await requestPlanPrice(body)).toEqual({ refusal: { status: 0, reason: null, field: null } });
    session = null;
    fetchMock.mockReset();
    expect(await requestPlanPrice(body)).toEqual({ refusal: { status: 401, reason: null, field: null } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
