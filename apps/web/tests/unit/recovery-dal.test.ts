import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const claimsMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: rpcMock, auth: { getClaims: claimsMock } }),
}));

const { hasRecoverySession, isRecoveryLinkFresh } = await import("@/lib/dal/recovery");

const now = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isRecoveryLinkFresh", () => {
  it("asks the database about the token hash and returns its answer", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    expect(await isRecoveryLinkFresh("abc_DEF-123")).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("recovery_link_is_fresh", { p_token_hash: "abc_DEF-123" });
    rpcMock.mockResolvedValue({ data: false, error: null });
    expect(await isRecoveryLinkFresh("abc_DEF-123")).toBe(false);
  });

  it.each(["", "a b", "<script>", "x".repeat(201)])(
    "does not ask the database about the malformed token %j",
    async (token) => {
      expect(await isRecoveryLinkFresh(token)).toBe(false);
      expect(rpcMock).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the database cannot answer", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(isRecoveryLinkFresh("abc")).rejects.toThrow("could not be checked");
  });
});

describe("hasRecoverySession", () => {
  it("accepts a one-time-code sign-in from the last 15 minutes", async () => {
    claimsMock.mockResolvedValue({
      data: { claims: { amr: [{ method: "password", timestamp: now() - 7_200 }, { method: "otp", timestamp: now() - 60 }] } },
    });
    expect(await hasRecoverySession()).toBe(true);
  });

  it.each([
    ["an older one-time-code sign-in", { claims: { amr: [{ method: "otp", timestamp: now() - 901 }] } }],
    ["a password sign-in", { claims: { amr: [{ method: "password", timestamp: now() }] } }],
    ["a legacy string entry", { claims: { amr: ["otp"] } }],
    ["no sign-in methods", { claims: {} }],
    ["no session", null],
  ])("refuses %s", async (_label, data) => {
    claimsMock.mockResolvedValue({ data });
    expect(await hasRecoverySession()).toBe(false);
  });
});
