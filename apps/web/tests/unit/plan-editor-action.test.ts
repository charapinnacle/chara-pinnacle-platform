import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateMock = vi.hoisted(() => vi.fn());
const requireRoleMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const rpcMock = vi.fn();
const priceMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/dal/session", () => ({ requirePlatformRole: requireRoleMock }));
vi.mock("@/lib/dal/admin", () => ({ adminClient: async () => ({ rpc: rpcMock }) }));
vi.mock("@/lib/dal/plan-editor", () => ({ requestPlanPrice: priceMock }));

const { changePlanPrice, removeLimitOverride, savePlan, saveSetting, setLimitOverride } = await import("@/lib/actions/plan-editor");

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
  const plan = { name: "Basic Plus", isPublic: true, trialDays: 14, expected: { name: "Basic", isPublic: true, trialDays: 30 } };

  it("asks for the administrator and saves the whole edit in one call with the shown values and the trimmed reason", async () => {
    expect(
      await savePlan({
        code: "recruitment_partner",
        plan,
        limits: [
          { key: "job_order_responses_per_month", value: 12, expected: 10 },
          { key: "markets", value: null, expected: 3 },
        ],
        features: [{ key: "analytics_advanced", enabled: true, expected: false }],
        reason: `  ${reason}  `,
      }),
    ).toEqual({ done: true });
    expect(requireRoleMock).toHaveBeenCalledWith("en", ["admin"]);
    expect(rpcMock.mock.calls).toEqual([
      [
        "admin_update_plan_bundle",
        {
          p_code: "recruitment_partner",
          p_changes: {
            plan: { name: "Basic Plus", is_public: true, trial_days: 14, expected: { name: "Basic", is_public: true, trial_days: 30 } },
            limits: [
              { key: "job_order_responses_per_month", value: 12, expected: 10 },
              { key: "markets", value: null, expected: 3 },
            ],
            features: [{ key: "analytics_advanced", enabled: true, expected: false }],
          },
          p_reason: reason,
        },
      ],
    ]);
    expect(revalidateMock).toHaveBeenCalledWith("/en/admin/plans");
  });

  it("refuses a short reason or an edit without changes before calling anything", async () => {
    expect((await savePlan({ code: "recruitment_partner", plan: null, limits: [{ key: "markets", value: 4, expected: 3 }], features: [], reason: "short" })).errors).toEqual({
      reason: "Give a reason of at least 10 characters.",
    });
    expect((await savePlan({ code: "recruitment_partner", plan: null, limits: [], features: [], reason })).errors).toEqual({
      reason: "Change at least one value.",
    });
    expect(requireRoleMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    [failure("CHARA_INVALID_INPUT", "is_public"), { errors: { isPublic: "Only a paid plan can be public" } }],
    [failure("CHARA_INVALID_INPUT", "reason"), { errors: { reason: "Give a reason of 10 to 500 characters." } }],
    [failure("CHARA_INVALID_INPUT", "plan_code"), { message: "This plan no longer exists." }],
    [failure("CHARA_CONFLICT", "limit:markets"), { message: "Someone changed this plan after the page was loaded. Nothing was saved. Reload the page and try again." }],
    [failure("CHARA_FORBIDDEN"), { message: "You are not allowed to do this." }],
  ])("maps the refusal %j", async (refusal, expected) => {
    rpcMock.mockResolvedValue(refusal);
    expect(await savePlan({ code: "free_staffing_company", plan: { ...plan, name: "Free" }, limits: [], features: [], reason })).toEqual(expected);
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("sends the administrator to confirm two-step verification when it lapsed", async () => {
    rpcMock.mockResolvedValue(failure("CHARA_FORBIDDEN", "aal2_required"));
    await expect(savePlan({ code: "recruitment_partner", plan: null, limits: [{ key: "markets", value: 4, expected: 3 }], features: [], reason })).rejects.toThrow(
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
      expiresOn: "Enter a date after today as year-month-day.",
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

  it("names the legal documents when the go-live gate refuses a release switch", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FORBIDDEN", details: "release_legal_gaps", hint: "partner-terms:draft,partner-dpa:missing", code: "P0001" } });
    expect(await saveSetting({ key: "release_partner_directories", value: "true", reason })).toEqual({
      message: "The release cannot go live until these legal documents are approved: partner-terms: still a draft; partner-dpa: not published.",
    });
  });

  it.each([
    [failure("CHARA_INVALID_INPUT", "value"), { errors: { value: "This value is outside the rule of the setting" } }],
    [failure("CHARA_FORBIDDEN", "setting_not_editable"), { message: "This setting cannot be changed here." }],
  ])("maps the refusal %j", async (refusal, expected) => {
    rpcMock.mockResolvedValue(refusal);
    expect(await saveSetting({ key: "entitlements_enforced", value: "false", reason })).toEqual(expected);
  });
});

describe("changePlanPrice (FR-R2 AC8)", () => {
  const refused = (status: number, reason: string | null = null, field: string | null = null) => ({ refusal: { status, reason, field } });

  it("asks for the administrator, sends the plan, the amount in minor units and the trimmed reason to the function", async () => {
    priceMock.mockResolvedValue({ done: true });
    expect(await changePlanPrice({ code: "recruitment_partner", priceMinor: 5400, reason: `  ${reason}  ` })).toEqual({ done: true });
    expect(requireRoleMock).toHaveBeenCalledWith("en", ["admin"]);
    expect(priceMock).toHaveBeenCalledWith({ plan_code: "recruitment_partner", price_minor: 5400, reason });
    expect(revalidateMock).toHaveBeenCalledWith("/en/admin/plans");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("refuses an amount outside 100 to 10,000,000 minor units or a short reason before calling the function", async () => {
    for (const input of [
      { code: "recruitment_partner", priceMinor: 99, reason },
      { code: "recruitment_partner", priceMinor: 10_000_001, reason },
      { code: "recruitment_partner", priceMinor: 54.5, reason },
      { code: "recruitment_partner", priceMinor: 5400, reason: "too short" },
      { code: "Recruitment Partner", priceMinor: 5400, reason },
    ]) {
      expect((await changePlanPrice(input)).errors).toBeDefined();
    }
    expect(priceMock).not.toHaveBeenCalled();
  });

  it("sends an administrator whose second factor lapsed to confirm it again", async () => {
    priceMock.mockResolvedValue(refused(403, "aal2_required"));
    await expect(changePlanPrice({ code: "recruitment_partner", priceMinor: 5400, reason })).rejects.toThrow("REDIRECT:/en/mfa?next=%2Fen%2Fadmin%2Fplans");
  });

  it("explains the refusals and says nothing was changed when the provider fails", async () => {
    const cases: [ReturnType<typeof refused>, object][] = [
      [refused(403), { message: "You are not allowed to do this." }],
      [refused(400, null, "reason"), { errors: { reason: "Give a reason of 10 to 500 characters." } }],
      [refused(400, null, "price_unchanged"), { errors: { amount: "Enter a price other than the current one." } }],
      [refused(409, "plan_not_synced"), { message: "This plan is not set up at the payment provider yet. Nothing was changed." }],
      [refused(502), { message: "The payment provider could not create the new price. Nothing was changed. Try again later." }],
      [refused(0), { message: "The payment provider could not create the new price. Nothing was changed. Try again later." }],
    ];
    for (const [answer, expected] of cases) {
      priceMock.mockResolvedValueOnce(answer);
      expect(await changePlanPrice({ code: "recruitment_partner", priceMinor: 5400, reason })).toEqual(expected);
    }
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});
