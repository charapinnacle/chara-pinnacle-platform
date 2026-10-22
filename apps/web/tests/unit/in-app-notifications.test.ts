import { beforeEach, describe, expect, it, vi } from "vitest";
import { emailKindsSchema, markReadSchema } from "@/lib/validation/notifications";

const revalidateMock = vi.hoisted(() => vi.fn());
type Result = { data: unknown; error: unknown };
let rpcResult: Result = { data: null, error: null };
const rpcCalls: unknown[][] = [];

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      return Promise.resolve(rpcResult);
    },
  }),
}));

const { listMyNotifications, markNotificationsRead: markInDal } = await import("@/lib/dal/notifications");
const { fetchUnreadNotificationCount, markNotificationsRead, saveEmailKindSettings } = await import("@/lib/actions/notifications");

const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  rpcCalls.length = 0;
  rpcResult = { data: null, error: null };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("emailKindsSchema", () => {
  it("accepts a choice per kind", () => {
    expect(emailKindsSchema.parse({ kinds: { application_received: false } })).toEqual({ kinds: { application_received: false } });
  });

  it.each([{ kinds: {} }, { kinds: { "Bad-Kind": true } }, { kinds: { application_received: "no" } }, { kinds: { a: true } }, { kinds: [] }, {}])(
    "refuses %j",
    (input) => {
      expect(emailKindsSchema.safeParse(input).success).toBe(false);
    },
  );
});

describe("markReadSchema", () => {
  it("accepts null (every item) and 1 to 100 ids", () => {
    expect(markReadSchema.parse(null)).toBeNull();
    expect(markReadSchema.parse([ID])).toEqual([ID]);
  });

  it.each([[[]], [["not-an-id"]], [Array.from({ length: 101 }, () => ID)]])("refuses %j", (input) => {
    expect(markReadSchema.safeParse(input).success).toBe(false);
  });
});

describe("in-app notifications DAL", () => {
  it("reads a page with its cursor and keeps only object payloads", async () => {
    rpcResult = {
      data: [
        { id: ID, kind: "mfa_reset", payload: {}, read_at: null, created_at: "2026-10-22T10:00:00Z", next_cursor: null },
        { id: "b", kind: "mfa_reset", payload: ["x"], read_at: "2026-10-22T11:00:00Z", created_at: "2026-10-21T10:00:00Z", next_cursor: "c|b" },
      ],
      error: null,
    };
    const page = await listMyNotifications("a|b");
    expect(rpcCalls).toEqual([["list_my_notifications", { p_cursor: "a|b", p_limit: 20 }]]);
    expect(page.nextCursor).toBe("c|b");
    expect(page.items.map((item) => [item.readAt, item.payload])).toEqual([
      [null, {}],
      ["2026-10-22T11:00:00Z", {}],
    ]);
  });

  it("throws when the list cannot be read", async () => {
    rpcResult = { data: null, error: { message: "CHARA_FORBIDDEN" } };
    await expect(listMyNotifications(null)).rejects.toThrow("The notifications could not be loaded");
  });

  it("marks all items with no ids and some with p_ids", async () => {
    await markInDal(null);
    await markInDal([ID]);
    expect(rpcCalls).toEqual([
      ["mark_notifications_read", {}],
      ["mark_notifications_read", { p_ids: [ID] }],
    ]);
  });
});

describe("in-app notification actions", () => {
  it("refuses a malformed id list without calling the database", async () => {
    expect(await markNotificationsRead(["x"])).toEqual({ message: expect.any(String) });
    expect(rpcCalls).toEqual([]);
  });

  it("revalidates the list after marking", async () => {
    expect(await markNotificationsRead(null)).toEqual({});
    expect(revalidateMock).toHaveBeenCalledWith("/en/notifications");
  });

  it("answers null for the bell when the count cannot be read", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    expect(await fetchUnreadNotificationCount()).toBeNull();
    rpcResult = { data: 3, error: null };
    expect(await fetchUnreadNotificationCount()).toBe(3);
  });

  it("explains a refused mandatory kind and saves a valid choice", async () => {
    rpcResult = { data: null, error: { message: "CHARA_INVALID_INPUT", details: "mandatory_kind" } };
    expect(await saveEmailKindSettings({ kinds: { vacancy_hidden: false } })).toEqual({
      message: "Emails that are always sent cannot be switched off.",
    });
    rpcResult = { data: null, error: null };
    expect(await saveEmailKindSettings({ kinds: { application_received: false } })).toEqual({ done: true });
    expect(rpcCalls.at(-1)).toEqual(["set_notification_preferences", { p_kinds: { application_received: false } }]);
  });
});
