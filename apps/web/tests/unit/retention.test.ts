import { beforeEach, describe, expect, it, vi } from "vitest";
import { monthsText, periodText, retentionFormSchema, retentionInputSchema } from "@/lib/validation/retention";

const revalidateMock = vi.hoisted(() => vi.fn());
const requireRoleMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const rpcMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/session", () => ({ requirePlatformRole: requireRoleMock }));
vi.mock("@/lib/dal/admin", () => ({
  adminClient: async () => ({ rpc: rpcMock }),
  failure: (what: string, cause: unknown) => new Error(`${what} could not be loaded`, { cause }),
}));

const { saveRetentionPolicy } = await import("@/lib/actions/retention");
const { listRetentionPolicies } = await import("@/lib/dal/retention");

const reason = "Shorter period agreed with CHARA.";
const refusal = (message: string, details = "", code = "P0001") => ({ data: null, error: { message, details, code } });

beforeEach(() => {
  vi.clearAllMocks();
  requireRoleMock.mockResolvedValue({ user: { id: "staff" }, roles: ["admin"] });
  rpcMock.mockResolvedValue({ data: true, error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("the period in days and months (FR-S3 AC10)", () => {
  it("shows 730 days as 24 months and rounds to one decimal", () => {
    expect(monthsText(730)).toBe("24 months");
    expect(monthsText(365)).toBe("12 months");
    expect(monthsText(30)).toBe("1 month");
    expect(monthsText(35)).toBe("1.1 months");
    expect(monthsText(29)).toBe("less than 1 month");
    expect(monthsText(3650)).toBe("119.9 months");
    expect(periodText(2191)).toBe("2,191 days (72 months)");
    expect(periodText(1)).toBe("1 day (less than 1 month)");
  });
});

describe("the period form (FR-S3 AC10)", () => {
  const days = (value: string) => retentionFormSchema.safeParse({ days: value, reason });

  it("accepts whole numbers from 1 to 3,650 days", () => {
    expect(days("1").success).toBe(true);
    expect(days(" 365 ").success).toBe(true);
    expect(days("3650").success).toBe(true);
  });

  it("refuses 0, 3,651, 40,000, decimals, signs and words with one message", () => {
    for (const value of ["0", "3651", "40000", "12.5", "-5", "+5", "a year", ""]) {
      const result = days(value);
      expect(result.success, value).toBe(false);
      expect(result.error?.issues[0].message, value).toBe("Enter a whole number of days from 1 to 3,650.");
    }
  });

  it("asks for a reason of 10 to 500 characters", () => {
    expect(retentionFormSchema.safeParse({ days: "365", reason: "too short" }).error?.issues[0].message).toBe(
      "Give a reason of at least 10 characters.",
    );
    expect(retentionFormSchema.safeParse({ days: "365", reason: "r".repeat(501) }).success).toBe(false);
  });

  it("checks the entity key and the bounds again before the server call", () => {
    expect(retentionInputSchema.safeParse({ entity: "conversations", days: 365, reason }).success).toBe(true);
    expect(retentionInputSchema.safeParse({ entity: "Conversations; drop", days: 365, reason }).success).toBe(false);
    expect(retentionInputSchema.safeParse({ entity: "conversations", days: 0, reason }).success).toBe(false);
    expect(retentionInputSchema.safeParse({ entity: "conversations", days: 3651, reason }).success).toBe(false);
  });
});

describe("saveRetentionPolicy (FR-S3 AC1, AC10)", () => {
  it("asks for the administrator and saves the period with the trimmed reason", async () => {
    expect(await saveRetentionPolicy({ entity: "conversations", days: 365, reason: `  ${reason}  ` })).toEqual({ done: true });
    expect(requireRoleMock).toHaveBeenCalledWith("en", ["admin"]);
    expect(rpcMock.mock.calls).toEqual([["admin_set_retention_policy", { p_entity: "conversations", p_days: 365, p_reason: reason }]]);
    expect(revalidateMock).toHaveBeenCalledWith("/en/admin/retention");
  });

  it("refuses a period out of bounds or a short reason before calling anything", async () => {
    expect((await saveRetentionPolicy({ entity: "conversations", days: 0, reason })).errors).toHaveProperty("days");
    expect((await saveRetentionPolicy({ entity: "conversations", days: 40000, reason })).errors).toHaveProperty("days");
    expect((await saveRetentionPolicy({ entity: "conversations", days: 365, reason: "short" })).errors).toEqual({
      reason: "Give a reason of at least 10 characters.",
    });
    expect(requireRoleMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("names the field the database refused and keeps the cause to itself", async () => {
    rpcMock.mockResolvedValueOnce(refusal("CHARA_INVALID_INPUT", "days"));
    expect(await saveRetentionPolicy({ entity: "conversations", days: 365, reason })).toEqual({
      errors: { days: "Enter a whole number of days from 1 to 3,650." },
    });
    rpcMock.mockResolvedValueOnce(refusal("new row violates check constraint", "", "23514"));
    expect(await saveRetentionPolicy({ entity: "conversations", days: 365, reason })).toEqual({
      errors: { days: "Enter a whole number of days from 1 to 3,650." },
    });
    rpcMock.mockResolvedValueOnce(refusal("CHARA_INVALID_INPUT", "reason"));
    expect(await saveRetentionPolicy({ entity: "conversations", days: 365, reason })).toEqual({
      errors: { reason: "Give a reason of 10 to 500 characters." },
    });
    rpcMock.mockResolvedValueOnce(refusal("CHARA_FORBIDDEN", "retention_not_editable"));
    expect(await saveRetentionPolicy({ entity: "audit_log", days: 365, reason })).toEqual({ message: "This period cannot be changed here." });
    rpcMock.mockResolvedValueOnce(refusal("CHARA_FORBIDDEN"));
    expect(await saveRetentionPolicy({ entity: "conversations", days: 365, reason })).toEqual({ message: "You are not allowed to do this." });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("sends an administrator whose two-step verification lapsed to confirm it and back to the page", async () => {
    rpcMock.mockResolvedValueOnce(refusal("CHARA_FORBIDDEN", "aal2_required"));
    await expect(saveRetentionPolicy({ entity: "conversations", days: 365, reason })).rejects.toThrow(
      `REDIRECT:/en/mfa?next=${encodeURIComponent("/en/admin/retention")}`,
    );
  });
});

describe("listRetentionPolicies (FR-S3 AC10)", () => {
  it("maps every period of the editor", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ entity: "conversations", label: "Conversations", description: "Days a conversation is kept.", days: 730, editable: true }],
      error: null,
    });
    expect(await listRetentionPolicies()).toEqual([
      { entity: "conversations", label: "Conversations", description: "Days a conversation is kept.", days: 730, editable: true },
    ]);
    expect(rpcMock).toHaveBeenCalledWith("admin_list_retention_policies");
  });

  it("throws for the error boundary when the periods cannot be read", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "permission denied", code: "42501" } });
    await expect(listRetentionPolicies()).rejects.toThrow("The retention periods could not be loaded");
  });
});
