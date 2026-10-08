import { beforeEach, describe, expect, it, vi } from "vitest";
import { notificationSettingsSchema, type NotificationSettings } from "@/lib/validation/notifications";

const saveMock = vi.hoisted(() => vi.fn());
const revalidateMock = vi.hoisted(() => vi.fn());
type Result = { data: unknown; error: unknown };
let rpcResult: Result = { data: null, error: null };
let selectResult: Result = { data: null, error: null };
const rpcCalls: unknown[][] = [];

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      return Promise.resolve(rpcResult);
    },
    from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve(selectResult) }) }),
  }),
}));

const { getEmailDelivery, saveEmailDelivery } = await import("@/lib/dal/notifications");

beforeEach(() => {
  vi.clearAllMocks();
  rpcCalls.length = 0;
  rpcResult = { data: null, error: null };
  selectResult = { data: null, error: null };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("notificationSettingsSchema", () => {
  it.each(["immediate", "daily_summary"])("accepts %s", (delivery) => {
    expect(notificationSettingsSchema.parse({ delivery })).toEqual({ delivery });
  });

  it.each(["", "weekly", "Immediate", "true", undefined])("refuses the value %s with a message for the field", (delivery) => {
    const result = notificationSettingsSchema.safeParse({ delivery });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Choose how to receive new-application emails");
  });

  it("refuses an unknown field", () => {
    expect(notificationSettingsSchema.safeParse({ delivery: "immediate", digest: true }).success).toBe(false);
  });
});

describe("getEmailDelivery", () => {
  it("is immediate for a user without a row and for digest false, a daily summary for digest true", async () => {
    expect(await getEmailDelivery()).toBe("immediate");
    selectResult = { data: { digest: false }, error: null };
    expect(await getEmailDelivery()).toBe("immediate");
    selectResult = { data: { digest: true }, error: null };
    expect(await getEmailDelivery()).toBe("daily_summary");
  });

  it("fails loudly when the read fails", async () => {
    selectResult = { data: null, error: { code: "XX000" } };
    await expect(getEmailDelivery()).rejects.toThrow("The notification settings could not be loaded");
  });
});

describe("saveEmailDelivery", () => {
  it("sends the daily summary as digest true and immediate as digest false", async () => {
    expect(await saveEmailDelivery("daily_summary")).toBeNull();
    expect(await saveEmailDelivery("immediate")).toBeNull();
    expect(rpcCalls).toEqual([
      ["set_notification_preferences", { p_digest: true }],
      ["set_notification_preferences", { p_digest: false }],
    ]);
  });

  it("maps the refusal of a candidate and hides any other error", async () => {
    rpcResult = { data: null, error: { code: "P0001", message: "CHARA_FORBIDDEN" } };
    expect(await saveEmailDelivery("immediate")).toBe("forbidden");
    rpcResult = { data: null, error: { code: "08006", message: "connection to 10.0.0.1 lost" } };
    expect(await saveEmailDelivery("immediate")).toBe("failed");
  });
});

describe("saveNotificationSettings", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/dal/notifications", () => ({ saveEmailDelivery: saveMock }));
    saveMock.mockResolvedValue(null);
  });

  it("saves a valid choice and refreshes the page", async () => {
    const { saveNotificationSettings } = await import("@/lib/actions/notifications");
    expect(await saveNotificationSettings({ delivery: "daily_summary" })).toEqual({ done: true });
    expect(saveMock).toHaveBeenCalledWith("daily_summary");
    expect(revalidateMock).toHaveBeenCalledWith("/en/settings/notifications");
  });

  it("does not call the database for an invalid value or an unknown field", async () => {
    const { saveNotificationSettings } = await import("@/lib/actions/notifications");
    const invalid = { delivery: "weekly" } as unknown as NotificationSettings;
    expect((await saveNotificationSettings(invalid)).errors).toEqual({ delivery: "Choose how to receive new-application emails" });
    const extra = { delivery: "immediate", digest: true } as unknown as NotificationSettings;
    expect((await saveNotificationSettings(extra)).errors).toBeDefined();
    expect(saveMock).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("answers a refusal with a sentence and no database text", async () => {
    const { saveNotificationSettings } = await import("@/lib/actions/notifications");
    saveMock.mockResolvedValue("forbidden");
    expect(await saveNotificationSettings({ delivery: "immediate" })).toEqual({
      message: "Only employer accounts can choose how new-application emails are sent.",
    });
    saveMock.mockResolvedValue("failed");
    expect((await saveNotificationSettings({ delivery: "immediate" })).message).toBe("We could not complete this request. Try again.");
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});
