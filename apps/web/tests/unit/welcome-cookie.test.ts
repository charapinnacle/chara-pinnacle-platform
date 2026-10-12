import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ values: new Map<string, string>(), set: vi.fn(), delete: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SITE_URL: "https://chara.example" } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name) } : undefined),
    set: jar.set,
    delete: jar.delete,
  }),
}));

const { forgetWelcome, rememberWelcome, welcomeIsDue } = await import("@/lib/welcome-cookie");

const userId = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";

beforeEach(() => {
  vi.clearAllMocks();
  jar.values.clear();
});

describe("the welcome cookie", () => {
  it("is set for the account, unreadable by scripts, for the welcome page only and for ten minutes", async () => {
    await rememberWelcome(userId);
    expect(jar.set).toHaveBeenCalledExactlyOnceWith("chara_welcome", userId, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/en/onboarding/welcome",
      maxAge: 600,
    });
  });

  it("makes the welcome due only for the account it names", async () => {
    expect(await welcomeIsDue(userId)).toBe(false);
    jar.values.set("chara_welcome", userId);
    expect(await welcomeIsDue(userId)).toBe(true);
    expect(await welcomeIsDue("0a1b2c3d-0000-4000-8000-000000000001")).toBe(false);
    jar.values.set("chara_welcome", "not an id");
    expect(await welcomeIsDue("not an id")).toBe(false);
  });

  it("is removed on the path it was set for", async () => {
    await forgetWelcome();
    expect(jar.delete).toHaveBeenCalledExactlyOnceWith({ name: "chara_welcome", path: "/en/onboarding/welcome" });
  });
});
