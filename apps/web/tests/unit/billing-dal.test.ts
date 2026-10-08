import { beforeEach, describe, expect, it, vi } from "vitest";

let session: { access_token: string } | null = { access_token: "token-of-the-owner" };
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421" } }));
vi.mock("@/lib/env.server", () => ({ serverEnv: () => ({ BILLING_CHECKOUT_ENDPOINT: process.env.TEST_ENDPOINT }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
}));

const { requestHostedSession } = await import("@/lib/dal/billing");

beforeEach(() => {
  session = { access_token: "token-of-the-owner" };
  delete process.env.TEST_ENDPOINT;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("requestHostedSession", () => {
  it("forwards the owner's own token to the function and returns the hosted address", async () => {
    fetchMock.mockResolvedValue(Response.json({ url: "https://checkout.stripe.com/c/pay/cs_1" }));
    const result = await requestHostedSession({ action: "portal", orgId: "o1" });
    expect(result).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_1" });
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe("http://127.0.0.1:54421/functions/v1/billing-checkout");
    expect(init.headers.authorization).toBe("Bearer token-of-the-owner");
    expect(JSON.parse(init.body)).toEqual({ action: "portal", orgId: "o1" });
    expect(init.cache).toBe("no-store");
  });

  it("uses the address a deployment names", async () => {
    process.env.TEST_ENDPOINT = "http://127.0.0.1:54434/";
    fetchMock.mockResolvedValue(Response.json({ url: "https://billing.stripe.com/p/session/s_1" }));
    await requestHostedSession({});
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:54434/");
  });

  it("does not call the function without a session", async () => {
    session = null;
    expect(await requestHostedSession({})).toEqual({ refusal: { status: 401, reason: null, field: null } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [Response.json({ error: "forbidden", reason: "trial_changed" }, { status: 403 }), { status: 403, reason: "trial_changed", field: null }],
    [Response.json({ error: "bad_request", field: "vat_id" }, { status: 400 }), { status: 400, reason: null, field: "vat_id" }],
    [Response.json({ error: "unavailable" }, { status: 502 }), { status: 502, reason: null, field: null }],
    [new Response("not json", { status: 500 }), { status: 500, reason: null, field: null }],
  ])("reads a refusal of the function (%#)", async (response, refusal) => {
    fetchMock.mockResolvedValue(response);
    expect(await requestHostedSession({})).toEqual({ refusal });
  });

  it.each([
    ["an address that is not https", { url: "http://checkout.example/x" }],
    ["an answer without an address", {}],
    ["an address that is not an address", { url: "javascript:alert(1)" }],
  ])("refuses %s even when the answer says ok", async (_, body) => {
    fetchMock.mockResolvedValue(Response.json(body));
    expect(await requestHostedSession({})).toEqual({ refusal: { status: 502, reason: null, field: null } });
  });

  it("answers a network failure with a refusal and no detail", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed: connect ECONNREFUSED"));
    expect(await requestHostedSession({})).toEqual({ refusal: { status: 0, reason: null, field: null } });
  });
});
