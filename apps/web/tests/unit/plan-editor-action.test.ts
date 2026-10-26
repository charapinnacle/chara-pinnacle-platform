import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/dal/admin", () => ({ adminClient: async () => ({ rpc: rpcMock }) }));

const { removeLimitOverride, savePlan, saveSetting, setLimitOverride } = await import("@/lib/actions/plan-editor");

const ORG = "6f1c1c2e-8a3b-4c55-9b1e-2d3f4a5b6c7d";
const reason = "Raise after first month of usage review";
const ok = { data: true, error: null };
const failure = (message: string, details = "") => ({ data: null, error: { message, details, code: "P0001" } });

beforeEach(() => {
  vi.clearAllMocks();
  requireRoleMock.mockResolvedValue({ user: { id: "staff" }, roles: ["admin"] });
  rpcMock.mockResolvedValue(ok);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("savePlan (FR-R2 AC2, AC10)", () => {
  it("asks for the administrator and saves the plan row, then each limit and feature, with the trimmed reason", async () => {
    expect(
      await savePlan({
        code: "recruitment_partner",
        plan: { name: "Basic Plus", isPublic: true, trialDays: 14 },
        limits: [
          { key: "job_order_responses_per_month", value: 12 },
          { key: "markets", value: null },
        ],
        features: [{ key: "analytics_advanced", enabled: true }],
        reason: `  ${reason}  `,
      }),
    ).toEqual({ done: true });
    expect(requireRoleMock).toHaveBeenCalledWith("en", ["admin"]);
    expect(rpcMock.mock.calls).toEqual([
      ["admin_update_plan", { p_code: "recruitment_partner", p_name: "Basic Plus", p_is_public: true, p_trial_days: 14, p_reason: reason }],
      ["admin_set_plan_limit", { p_code: "recruitment_partner", p_limit_key: "job_order_responses_per_month", p_value: 12, p_reason: reason }],
      ["admin_set_plan_limit", { p_code: "recruitment_partner", p_limit_key: "markets", p_value: undefined, p_reason: reason }],
      ["admin_set_plan_feature", { p_code: "recruitment_partner", p_feature_key: "analytics_advanced", p_enabled: true, p_reason: reason }],
    ]);
    expect(revalidateMock).toHaveBeenCalledWith("/en/admin/plans");
  });

  it("refuses a short reason or an edit without changes before calling anything", async () => {
    expect((await savePlan({ code: "recruitment_partner", plan: null, limits: [{ key: "markets", value: 4 }], features: [], reason: "short" })).errors).toEqual({
      reason: "Give a reason of at least 10 characters",
    });
    expect((await savePlan({ code: "recruitment_partner", plan: null, limits: [], features: [], reason })).errors).toEqual({
      reason: "Change at least one value",
    });
    expect(requireRoleMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("stops at the first refusal and reports it on its field", async () => {
    rpcMock.mockResolvedValueOnce(ok).mockResolvedValueOnce(failure("CHARA_INVALID_INPUT", "limit_value"));
    expect(
      await savePlan({
        code: "recruitment_partner",
        plan: null,
        limits: [
          { key: "markets", value: 5 },
          { key: "members", value: 6 },
          { key: "workforce_listings", value: 7 },
        ],
        features: [],
        reason,
      }),
    ).toEqual({ errors: { "limits.members.value": "Enter a whole number from 0 to 1,000,000" } });
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it.each([
    [failure("CHARA_INVALID_INPUT", "is_public"), { errors: { isPublic: "Only a paid plan can be public" } }],
    [failure("CHARA_INVALID_INPUT", "reason"), { errors: { reason: "Give a reason of 10 to 500 characters" } }],
    [failure("CHARA_INVALID_INPUT", "plan_code"), { message: "This plan no longer exists." }],
    [failure("CHARA_FORBIDDEN"), { message: "You are not allowed to do this." }],
  ])("maps the refusal %j", async (refusal, expected) => {
    rpcMock.mockResolvedValue(refusal);
    expect(await savePlan({ code: "free_staffing_company", plan: { name: "Free", isPublic: true, trialDays: 0 }, limits: [], features: [], reason })).toEqual(expected);
  });

  it("sends the administrator to confirm two-step verification when it lapsed", async () => {
    rpcMock.mockResolvedValue(failure("CHARA_FORBIDDEN", "aal2_required"));
    await expect(savePlan({ code: "recruitment_partner", plan: null, limits: [{ key: "markets", value: 4 }], features: [], reason })).rejects.toThrow(
      `REDIRECT:/en/mfa?next=${encodeURIComponent("/en/admin/plans")}`,
    );
  });
});

describe("setLimitOverride and removeLimitOverride (FR-R2 AC5)", () => {
  const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);

  it("sends the value and the start of the expiry day", async () => {
    expect(await setLimitOverride({ organizationId: ORG, limitKey: "members", value: 40, expiresOn: future, reason })).toEqual({ done: true });
    expect(rpcMock).toHaveBeenCalledWith("admin_set_limit_override", {
      p_org: ORG,
      p_limit_key: "members",
      p_value: 40,
      p_expires_at: `${future}T00:00:00Z`,
      p_reason: reason,
    });
    expect(revalidateMock).toHaveBeenCalledWith("/en/admin/plans/overrides");
  });

  it("refuses a past expiry before calling, and tells why an organisation not on Enterprise is refused", async () => {
    expect((await setLimitOverride({ organizationId: ORG, limitKey: "members", value: 40, expiresOn: "2020-01-01", reason })).errors).toEqual({
      expiresOn: "Enter a date after today as year-month-day",
    });
    expect(rpcMock).not.toHaveBeenCalled();
    rpcMock.mockResolvedValue(failure("CHARA_FORBIDDEN", "override_enterprise_only"));
    expect(await setLimitOverride({ organizationId: ORG, limitKey: "members", value: 40, expiresOn: future, reason })).toEqual({
      errors: { organizationId: "Only an organisation on an Enterprise plan can get an override" },
    });
  });

  it("removes an override once and says when it is gone", async () => {
    expect(await removeLimitOverride({ organizationId: ORG, limitKey: "members", reason })).toEqual({ done: true });
    expect(rpcMock).toHaveBeenCalledWith("admin_remove_limit_override", { p_org: ORG, p_limit_key: "members", p_reason: reason });
    rpcMock.mockResolvedValue(failure("CHARA_NOT_FOUND"));
    expect(await removeLimitOverride({ organizationId: ORG, limitKey: "members", reason })).toEqual({ message: "This override was already removed." });
  });
});

describe("saveSetting (FR-R2 AC7)", () => {
  it("sends the key, the value and the reason", async () => {
    expect(await saveSetting({ key: "stats_min_count", value: "20", reason })).toEqual({ done: true });
    expect(rpcMock).toHaveBeenCalledWith("admin_set_setting", { p_key: "stats_min_count", p_value: "20", p_reason: reason });
    expect(revalidateMock).toHaveBeenCalledWith("/en/admin/settings");
  });

  it.each([
    [failure("CHARA_INVALID_INPUT", "value"), { errors: { value: "This value is outside the rule of the setting" } }],
    [failure("CHARA_FORBIDDEN", "setting_not_editable"), { message: "This setting cannot be changed here." }],
  ])("maps the refusal %j", async (refusal, expected) => {
    rpcMock.mockResolvedValue(refusal);
    expect(await saveSetting({ key: "entitlements_enforced", value: "false", reason })).toEqual(expected);
  });
});
