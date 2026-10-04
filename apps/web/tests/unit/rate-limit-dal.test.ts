import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpcMock = vi.hoisted(() => vi.fn());
const headersMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { isThrottled } = await import("@/lib/dal/rate-limit");
const { visitorKey } = await import("@/lib/visitor-address");

const secret = "test-visitor-hash-secret-0123456789abcdef";

function request(forwardedFor: string | null) {
  headersMock.mockResolvedValue(new Headers(forwardedFor === null ? {} : { "x-forwarded-for": forwardedFor }));
}

beforeEach(() => {
  vi.clearAllMocks();
  request("203.0.113.99, 198.51.100.7");
  rpcMock.mockResolvedValue({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null });
});

describe("isThrottled", () => {
  it("counts the attempt under the keyed hash of the trusted address, never the address itself", async () => {
    expect(await isThrottled("login")).toBe(false);
    expect(rpcMock).toHaveBeenCalledOnce();
    expect(rpcMock).toHaveBeenCalledWith("rate_limit_attempt", {
      p_action: "login",
      p_key: visitorKey(secret, "198.51.100.7"),
    });
    expect(JSON.stringify(rpcMock.mock.calls)).not.toContain("198.51.100.7");
    expect(JSON.stringify(rpcMock.mock.calls)).not.toContain("203.0.113.99");
  });

  it("gives two visitors two keys, and a client's forged first entry no key of its own", async () => {
    await isThrottled("login");
    request("6.6.6.6, 198.51.100.7");
    await isThrottled("login");
    request("198.51.100.8");
    await isThrottled("login");
    const keys = rpcMock.mock.calls.map(([, args]) => args.p_key);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("answers true when the database says the attempt is over the limit", async () => {
    rpcMock.mockResolvedValue({ data: [{ allowed: false, retry_after_seconds: 120 }], error: null });
    expect(await isThrottled("signup")).toBe(true);
  });

  it("counts a request without an address under the shared key", async () => {
    request(null);
    await isThrottled("resend");
    expect(rpcMock).toHaveBeenCalledWith("rate_limit_attempt", {
      p_action: "resend",
      p_key: visitorKey(secret, null),
    });
  });

  it("fails instead of letting the attempt through when it cannot be counted", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "PGRST000" } });
    await expect(isThrottled("login")).rejects.toThrow("The attempt could not be counted");
    rpcMock.mockResolvedValue({ data: [], error: null });
    await expect(isThrottled("login")).rejects.toThrow("The attempt could not be counted");
  });
});
