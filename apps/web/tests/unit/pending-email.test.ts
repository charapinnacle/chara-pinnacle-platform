import { AuthApiError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const store = new Map<string, string>();
const setMock = vi.fn((name: string, value: string) => void store.set(name, value));
const deleteMock = vi.fn((target: string | { name: string }) => void store.delete(typeof target === "string" ? target : target.name));
const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const throttleMock = vi.hoisted(() => vi.fn());
const siteUrl = vi.hoisted(() => ({ value: "http://localhost:3100" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: setMock,
    delete: deleteMock,
    get: (name: string) => (store.has(name) ? { name, value: store.get(name) } : undefined),
  }),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/rate-limit", () => ({ throttleWait: throttleMock }));
vi.mock("@/lib/env", () => ({
  env: {
    get NEXT_PUBLIC_SITE_URL() {
      return siteUrl.value;
    },
  },
}));

const {
  cooldownLeft,
  forgetPendingEmail,
  maskEmail,
  offerPendingEmailAgain,
  pendingEmail,
  prefilledEmail,
  rememberPendingEmail,
  resendPending,
  RESEND_COOLDOWN_SECONDS,
} =
  await import("@/lib/pending-email");

const NOW = Date.parse("2026-10-12T10:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  store.clear();
  siteUrl.value = "http://localhost:3100";
  throttleMock.mockResolvedValue(0);
});

describe("maskEmail", () => {
  it.each([
    ["alirezai6@gmail.com", "a*****6@gmail.com"],
    ["ana@example.test", "a*****a@example.test"],
    ["ab@example.test", "a*****@example.test"],
    ["a@example.test", "a*****@example.test"],
    ["first.last+tag@sub.example.co.uk", "f*****g@sub.example.co.uk"],
  ])("shows %s as %s: the first and last character of the name and the whole domain", (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });

  it("gives every name of three or more characters the same number of stars, so its length is not shown", () => {
    expect(maskEmail("abc@x.test").split("@")[0]).toHaveLength(maskEmail("abcdefghij@x.test").split("@")[0].length);
  });
});

describe("cooldownLeft", () => {
  it("counts the 60 seconds from the send and rounds up, so the button never opens early", () => {
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
    expect(cooldownLeft(NOW, NOW)).toBe(60);
    expect(cooldownLeft(NOW - 17_400, NOW)).toBe(43);
    expect(cooldownLeft(NOW - 59_999, NOW)).toBe(1);
    expect(cooldownLeft(NOW - 60_000, NOW)).toBe(0);
    expect(cooldownLeft(NOW - 600_000, NOW)).toBe(0);
  });

  it("does not let a time in the future in an edited cookie make the wait longer than a minute", () => {
    expect(cooldownLeft(NOW + 86_400_000, NOW)).toBe(60);
  });
});

describe("the pending address cookie", () => {
  it("is httpOnly, SameSite=Lax, limited to the pages of the language, valid for 30 minutes and not Secure on http", async () => {
    await rememberPendingEmail("signup", "ana@example.test");
    expect(setMock).toHaveBeenCalledOnce();
    const [name, , options] = setMock.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(name).toBe("chara_pending_email");
    expect(options).toEqual({ httpOnly: true, sameSite: "lax", secure: false, path: "/en", maxAge: 1800 });
  });

  it("is Secure when the site is served over https", async () => {
    siteUrl.value = "https://chara.example";
    await rememberPendingEmail("recovery", "ana@example.test");
    expect((setMock.mock.calls[0] as unknown as [string, string, { secure: boolean }])[2].secure).toBe(true);
  });

  it("reads back the address and when it was sent, for its own purpose only", async () => {
    await rememberPendingEmail("signup", "ana@example.test");
    expect(await pendingEmail("signup")).toEqual({ purpose: "signup", email: "ana@example.test", sentAt: NOW });
    expect(await pendingEmail("recovery")).toBeNull();
  });

  it.each([["not json"], [JSON.stringify({ purpose: "signup", email: "nope", sentAt: 1 })], [JSON.stringify({ purpose: "other", email: "a@b.co", sentAt: 1 })], [JSON.stringify({ purpose: "signup", email: "a@b.co", sentAt: -5 })], ["[]"]])(
    "ignores a cookie that was altered: %s",
    async (value) => {
      store.set("chara_pending_email", value);
      expect(await pendingEmail("signup")).toBeNull();
    },
  );

  it("is removed on the same path it was set on", async () => {
    await rememberPendingEmail("signup", "ana@example.test");
    await forgetPendingEmail();
    expect(deleteMock).toHaveBeenCalledWith({ name: "chara_pending_email", path: "/en" });
    expect(deleteMock).toHaveBeenCalledWith({ name: "chara_prefill_email", path: "/en" });
    expect(await pendingEmail("signup")).toBeNull();
  });
});

describe("the address offered to a form again", () => {
  it("is not given to a form just because the address is pending: the form sees it only after Use a different address", async () => {
    await rememberPendingEmail("signup", "ana@example.test");
    expect(await prefilledEmail("signup")).toBeUndefined();
  });

  it("is kept for 60 seconds under its own cookie, with the same flags, for its own purpose only", async () => {
    await rememberPendingEmail("signup", "ana@example.test");
    setMock.mockClear();
    await offerPendingEmailAgain("signup");
    const [name, , options] = setMock.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(name).toBe("chara_prefill_email");
    expect(options).toEqual({ httpOnly: true, sameSite: "lax", secure: false, path: "/en", maxAge: 60 });
    expect(await prefilledEmail("signup")).toBe("ana@example.test");
    expect(await prefilledEmail("recovery")).toBeUndefined();
  });

  it("offers nothing when there is no pending address for that purpose", async () => {
    await rememberPendingEmail("recovery", "ana@example.test");
    await offerPendingEmailAgain("signup");
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(await prefilledEmail("signup")).toBeUndefined();
  });

  it("is removed when a new address is sent a link", async () => {
    await rememberPendingEmail("signup", "ana@example.test");
    await offerPendingEmailAgain("signup");
    await rememberPendingEmail("signup", "bo@example.test");
    expect(await prefilledEmail("signup")).toBeUndefined();
  });
});

describe("resendPending", () => {
  const send = vi.fn();
  const resend = () => resendPending("signup", "resend", "/verify-email", send);

  beforeEach(async () => {
    send.mockReset().mockResolvedValue(null);
    await rememberPendingEmail("signup", "ana@example.test");
    vi.setSystemTime(NOW + 61_000);
    setMock.mockClear();
  });

  it("goes back to the form that asks for the address when the cookie is gone", async () => {
    store.clear();
    await expect(resend()).rejects.toThrow("REDIRECT:/en/verify-email");
    expect(send).not.toHaveBeenCalled();
    expect(throttleMock).not.toHaveBeenCalled();
  });

  it("sends to the address of the cookie after the cooldown, counted under its limit before Auth, and starts a new cooldown", async () => {
    expect(await resend()).toEqual({ cooldown: 60, sent: true });
    expect(throttleMock).toHaveBeenCalledWith("resend");
    expect(send).toHaveBeenCalledWith("ana@example.test");
    expect(throttleMock.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
    expect(await pendingEmail("signup")).toMatchObject({ sentAt: NOW + 61_000 });
  });

  it("sends nothing before the 60 seconds are over and says how long is left, whatever the page asks", async () => {
    vi.setSystemTime(NOW + 20_000);
    expect(await resend()).toEqual({ cooldown: 40 });
    expect(send).not.toHaveBeenCalled();
    expect(throttleMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it("refuses a visitor over the limit with the wait time, sends nothing and keeps the cookie as it was", async () => {
    throttleMock.mockResolvedValue(130);
    expect(await resend()).toEqual({ cooldown: 0, message: "Too many attempts. Try again in 3 minutes." });
    expect(send).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it("answers an address that cannot be used, or that Auth holds back for its interval, as a sent email", async () => {
    send.mockResolvedValueOnce(new AuthApiError("For security purposes, you can only request this after 59 seconds.", 429, "over_email_send_rate_limit"));
    expect(await resend()).toEqual({ cooldown: 60, sent: true });
    vi.setSystemTime(NOW + 130_000);
    send.mockResolvedValueOnce(null);
    expect(await resend()).toEqual({ cooldown: 60, sent: true });
  });

  it("reports the limit of Auth without naming the account", async () => {
    send.mockResolvedValue(new AuthApiError("limit", 429, "over_request_rate_limit"));
    expect(await resend()).toEqual({ cooldown: 0, message: "Too many attempts. Try again in a few minutes." });
  });

  it("says that the email could not be sent for any other failure, logs only its code and status, and lets the visitor try at once", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    send.mockResolvedValue(new AuthApiError("smtp ana@example.test down", 500, "unexpected_failure"));
    expect(await resend()).toEqual({ cooldown: 0, message: "We could not complete this request. Try again." });
    expect(logged).toHaveBeenCalledWith("Resend failed", { code: "unexpected_failure", status: 500 });
    expect(JSON.stringify(logged.mock.calls)).not.toContain("example.test");
    expect(setMock).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
