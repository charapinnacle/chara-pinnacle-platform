import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateMock = vi.hoisted(() => vi.fn());
const requireUserMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.fn();
const singleMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("@/lib/dal/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...args: unknown[]) => {
      const result = rpcMock(...args);
      return Object.assign(Promise.resolve(result), { single: () => singleMock(...args) });
    },
  }),
}));

const { cancelAccountDeletion, requestAccountDeletion } = await import("@/lib/actions/account-closure");
const { getDeletionStatus } = await import("@/lib/dal/account-closure");
const { formatIsoDate } = await import("@/lib/i18n/format");

const GENERIC = "We could not complete this request. Try again.";

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11" });
  rpcMock.mockReturnValue({ data: null, error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("formatIsoDate", () => {
  it("gives the UTC date of a timestamp, whatever the time of day", () => {
    expect(formatIsoDate("2026-10-03T00:00:01+00:00")).toBe("2026-10-03");
    expect(formatIsoDate("2026-11-02T23:59:59.999Z")).toBe("2026-11-02");
    expect(formatIsoDate("2026-11-02T01:30:00+05:00")).toBe("2026-11-01");
  });
});

describe("getDeletionStatus", () => {
  it("maps the row of the database function and keeps nulls for a candidate with no request", async () => {
    singleMock.mockReturnValue({
      data: { requested_at: null, erases_on: null, can_cancel: false, cooling_off_days: 30 },
      error: null,
    });
    expect(await getDeletionStatus()).toEqual({ requestedAt: null, erasesOn: null, canCancel: false, coolingOffDays: 30 });
    expect(rpcMock).toHaveBeenCalledWith("account_deletion_status");
  });

  it("passes the dates of a pending request through", async () => {
    singleMock.mockReturnValue({
      data: { requested_at: "2026-10-03T09:00:00+00:00", erases_on: "2026-11-02T09:00:00+00:00", can_cancel: true, cooling_off_days: 30 },
      error: null,
    });
    expect(await getDeletionStatus()).toEqual({
      requestedAt: "2026-10-03T09:00:00+00:00",
      erasesOn: "2026-11-02T09:00:00+00:00",
      canCancel: true,
      coolingOffDays: 30,
    });
  });

  it("throws without the cause in the message when the read fails", async () => {
    singleMock.mockReturnValue({ data: null, error: { message: "secret" } });
    await expect(getDeletionStatus()).rejects.toThrow("The deletion status could not be loaded");
  });
});

describe.each([
  ["requestAccountDeletion", requestAccountDeletion, "request_account_deletion"],
  ["cancelAccountDeletion", cancelAccountDeletion, "cancel_account_deletion"],
] as const)("%s", (_name, action, rpc) => {
  it("requires a signed-in user without the consent gate, calls only its database function and refreshes the page", async () => {
    expect(await action()).toEqual({});
    expect(requireUserMock).toHaveBeenCalledWith("en", { consentGate: false });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(rpc);
    expect(revalidateMock).toHaveBeenCalledWith("/en/settings");
  });

  it("answers generically and logs a code, never details, when the database refuses", async () => {
    rpcMock.mockReturnValue({ data: null, error: { message: "CHARA_FORBIDDEN", code: "P0001", details: "worker_account_required" } });
    expect(await action()).toEqual({ message: GENERIC });
    expect(console.error).toHaveBeenCalledWith("Account closure failed", { rpc, code: "P0001", message: "CHARA_FORBIDDEN" });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("does not call the database for a visitor", async () => {
    requireUserMock.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(action()).rejects.toThrow("NEXT_REDIRECT");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("refusals with a message of their own", () => {
  it("tells a candidate whose time to cancel is over that the account is being erased", async () => {
    rpcMock.mockReturnValue({ data: null, error: { message: "CHARA_FORBIDDEN", code: "P0001", details: "cooling_off_ended" } });
    expect(await cancelAccountDeletion()).toEqual({ message: "The time to cancel is over. Your account is being erased." });
  });

  it("tells a candidate who asked too often to try again tomorrow", async () => {
    rpcMock.mockReturnValue({ data: null, error: { message: "CHARA_FORBIDDEN", code: "P0001", details: "rate_limited" } });
    expect(await requestAccountDeletion()).toEqual({ message: "You have asked too often today. Try again tomorrow." });
  });

  it("tells a candidate who holds a platform role to have it removed first", async () => {
    rpcMock.mockReturnValue({ data: null, error: { message: "CHARA_FORBIDDEN", code: "P0001", details: "platform_staff" } });
    expect(await requestAccountDeletion()).toEqual({ message: "Your account holds a platform role. Ask an administrator to remove it first." });
  });
});
