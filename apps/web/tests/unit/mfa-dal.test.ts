import { AuthSessionMissingError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const listFactorsMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { mfa: { listFactors: listFactorsMock } } }),
}));

const { hasVerifiedTotpFactor } = await import("@/lib/dal/mfa");

beforeEach(() => vi.clearAllMocks());

describe("hasVerifiedTotpFactor", () => {
  it("is true when a verified factor exists and false when none does", async () => {
    listFactorsMock.mockResolvedValueOnce({ data: { totp: [{ id: "f1" }] }, error: null });
    await expect(hasVerifiedTotpFactor("en")).resolves.toBe(true);
    listFactorsMock.mockResolvedValueOnce({ data: { totp: [] }, error: null });
    await expect(hasVerifiedTotpFactor("en")).resolves.toBe(false);
  });

  it.each([
    ["a missing session", new AuthSessionMissingError()],
    ["a revoked session", { status: 403, code: "session_not_found", message: "Session not found" }],
  ])("sends the user to the login page for %s", async (_name, error) => {
    listFactorsMock.mockResolvedValue({ data: null, error });
    await expect(hasVerifiedTotpFactor("en")).rejects.toThrow("REDIRECT:/en/login");
  });

  it("throws for any other failure", async () => {
    listFactorsMock.mockResolvedValue({ data: null, error: { status: 500, message: "boom" } });
    await expect(hasVerifiedTotpFactor("en")).rejects.toThrow("could not be loaded");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
