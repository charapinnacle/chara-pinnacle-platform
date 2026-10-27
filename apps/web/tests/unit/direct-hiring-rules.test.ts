import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  changeText,
  deleteConsequenceText,
  destinationText,
  parseRuleValues,
  ruleAgeText,
  ruleFormSchema,
  ruleLabels,
  type RuleForm,
} from "@/lib/validation/direct-hiring-rules";

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

const { saveDirectHiringRule, deleteDirectHiringRule } = await import("@/lib/actions/direct-hiring-rules");
const { listDirectHiringRules, listDirectHiringRuleHistory } = await import("@/lib/dal/direct-hiring-rules");

const reason = "Rule set after the legal opinion of November.";
const notice = "Hiring from the Philippines needs a licensed recruitment partner.";
const valid: RuleForm = { sourceCountry: "PH", destinationCountry: "", rule: "licensed_partner_required", notice, legalOpinionRef: "LO-2026-11 PH", reason };
const refusal = (message: string, details = "", code = "P0001") => ({ data: null, error: { message, details, code } });
const ID = "6b0c6f0e-6a55-4a43-9f7a-1c2d3e4f5a6b";

beforeEach(() => {
  vi.clearAllMocks();
  requireRoleMock.mockResolvedValue({ user: { id: "staff" }, roles: ["admin"] });
  rpcMock.mockResolvedValue({ data: true, error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("the rule form (FR-Q5 AC3, AC10)", () => {
  const issues = (values: Partial<RuleForm>) =>
    Object.fromEntries((ruleFormSchema.safeParse({ ...valid, ...values }).error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]));

  it("accepts a rule for all destinations and one for a single destination", () => {
    expect(ruleFormSchema.safeParse(valid).success).toBe(true);
    expect(ruleFormSchema.safeParse({ ...valid, destinationCountry: "DE", rule: "blocked" }).success).toBe(true);
  });

  it("accepts a notice of 20 and 1,000 characters and a reference of 1 and 200", () => {
    for (const values of [{ notice: "n".repeat(20) }, { notice: "n".repeat(1000) }, { legalOpinionRef: "L" }, { legalOpinionRef: "r".repeat(200) }]) {
      expect(ruleFormSchema.safeParse({ ...valid, ...values }).success, JSON.stringify(values).slice(0, 40)).toBe(true);
    }
  });

  it("names each refused field", () => {
    expect(issues({ sourceCountry: "" })).toEqual({ sourceCountry: "Choose a country" });
    expect(issues({ sourceCountry: "XXX" })).toEqual({ sourceCountry: "Choose a country" });
    expect(issues({ sourceCountry: "DE", destinationCountry: "DE" })).toEqual({
      destinationCountry: "Choose a destination other than the source country, or all destinations",
    });
    expect(issues({ rule: "" })).toEqual({ rule: "Choose a rule" });
    expect(issues({ rule: "partner" })).toEqual({ rule: "Choose a rule" });
    expect(issues({ notice: "n".repeat(19) })).toEqual({ notice: "Write a notice of at least 20 characters" });
    expect(issues({ notice: "n".repeat(1001) })).toEqual({ notice: "The notice can have at most 1,000 characters" });
    expect(issues({ notice: `${"n".repeat(20)}\n${"n".repeat(5)}` })).toEqual({ notice: "Write the notice as one paragraph without line breaks" });
    expect(issues({ legalOpinionRef: "   " })).toEqual({ legalOpinionRef: "Enter the legal opinion reference" });
    expect(issues({ legalOpinionRef: "r".repeat(201) })).toEqual({ legalOpinionRef: "The reference can have at most 200 characters" });
    expect(issues({ reason: "too short" })).toEqual({ reason: "Give a reason of at least 10 characters" });
  });
});

describe("the list texts (FR-Q5 AC10, SOP step 6)", () => {
  const now = new Date("2026-10-28T12:00:00Z");

  it("shows the age in whole days", () => {
    expect(ruleAgeText("2026-10-28T08:00:00Z", now)).toBe("Last changed today");
    expect(ruleAgeText("2026-10-27T11:00:00Z", now)).toBe("Last changed 1 day ago");
    expect(ruleAgeText("2026-10-18T12:00:00Z", now)).toBe("Last changed 10 days ago");
    expect(ruleAgeText("2025-09-23T12:00:00Z", now)).toBe("Last changed 400 days ago");
    expect(ruleAgeText("2023-01-01T12:00:00Z", now)).toBe("Last changed 1,396 days ago");
    expect(ruleAgeText("2026-10-29T12:00:00Z", now)).toBe("Last changed today");
  });

  it("names an empty destination all destinations and labels each rule value", () => {
    expect(destinationText(null)).toBe("All destinations");
    expect(destinationText("Germany")).toBe("Germany");
    expect(ruleLabels).toEqual({
      allowed: "Direct hiring allowed",
      licensed_partner_required: "Licensed partner required",
      blocked: "Direct hiring blocked",
    });
  });

  it("says that deleting a source rule returns the country to the default, and a pair to the source rule", () => {
    expect(deleteConsequenceText({ sourceName: "Philippines", destinationCountry: null, destinationName: null })).toMatch(
      /^Philippines returns to the default: direct hiring allowed with the general notice/,
    );
    expect(deleteConsequenceText({ sourceName: "Philippines", destinationCountry: "DE", destinationName: "Germany" })).toMatch(
      /^Workers in Philippines hired for Germany then follow the rule for all destinations of Philippines, or the default/,
    );
  });

  it("describes each change of the history", () => {
    const values = { source_country: "PH", destination_country: null, rule: "licensed_partner_required" as const, notice, legal_opinion_ref: "LO-1" };
    const base = { id: 1, createdAt: "2026-10-28T12:00:00Z", actorName: "Ada", reason };
    expect(changeText({ ...base, action: "created", before: null, after: values })).toBe("Added PH -> all destinations: Licensed partner required");
    expect(changeText({ ...base, action: "deleted", before: { ...values, destination_country: "DE" }, after: null })).toBe(
      "Deleted PH -> DE: Licensed partner required",
    );
    expect(
      changeText({ ...base, action: "updated", before: values, after: { ...values, rule: "blocked", notice: "Another notice text here.", legal_opinion_ref: "LO-2" } }),
    ).toBe("Changed PH -> all destinations: rule Licensed partner required -> Direct hiring blocked; notice; legal opinion LO-1 -> LO-2");
    expect(changeText({ ...base, action: "updated", before: null, after: null })).toBe("Changed a rule");
  });

  it("reads only the values the editor writes", () => {
    expect(parseRuleValues(null)).toBeNull();
    expect(parseRuleValues({ source_country: "PH" })).toBeNull();
    expect(parseRuleValues({ source_country: "PH", rule: "blocked", notice, legal_opinion_ref: "LO" })?.destination_country).toBeNull();
    expect(parseRuleValues({ source_country: "PH", destination_country: null, rule: "blocked", notice, legal_opinion_ref: "LO" })).toEqual({
      source_country: "PH",
      destination_country: null,
      rule: "blocked",
      notice,
      legal_opinion_ref: "LO",
    });
  });
});

describe("saveDirectHiringRule (FR-Q5 AC1, AC3)", () => {
  it("asks for the administrator and saves the trimmed values, all destinations as no destination", async () => {
    expect(await saveDirectHiringRule({ ...valid, notice: `  ${notice} `, reason: ` ${reason} ` })).toEqual({ done: true });
    expect(requireRoleMock).toHaveBeenCalledWith("en", ["admin"]);
    expect(rpcMock.mock.calls).toEqual([
      [
        "admin_upsert_direct_hiring_rule",
        { p_source: "PH", p_destination: undefined, p_rule: "licensed_partner_required", p_notice: notice, p_legal_opinion_ref: "LO-2026-11 PH", p_reason: reason },
      ],
    ]);
    expect(revalidateMock).toHaveBeenCalledWith("/en/admin/direct-hiring-rules");
    await saveDirectHiringRule({ ...valid, destinationCountry: "DE" });
    expect(rpcMock.mock.calls[1][1]).toMatchObject({ p_destination: "DE" });
  });

  it("refuses invalid input before calling anything", async () => {
    expect((await saveDirectHiringRule({ ...valid, legalOpinionRef: "" })).errors).toHaveProperty("legalOpinionRef");
    expect((await saveDirectHiringRule({ ...valid, sourceCountry: "DE", destinationCountry: "DE" })).errors).toHaveProperty("destinationCountry");
    expect(requireRoleMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("names the field the database refused and keeps the cause to itself", async () => {
    const cases: [string, Record<string, string>][] = [
      ["source_country", { sourceCountry: "Choose a country" }],
      ["destination_country", { destinationCountry: "Choose a destination other than the source country, or all destinations" }],
      ["rule", { rule: "Choose a rule" }],
      ["notice", { notice: "Write a notice of 20 to 1,000 characters" }],
      ["legal_opinion_ref", { legalOpinionRef: "Enter a reference of 1 to 200 characters" }],
      ["reason", { reason: "Give a reason of 10 to 500 characters" }],
    ];
    for (const [detail, errors] of cases) {
      rpcMock.mockResolvedValueOnce(refusal("CHARA_INVALID_INPUT", detail));
      expect(await saveDirectHiringRule(valid), detail).toEqual({ errors });
    }
    rpcMock.mockResolvedValueOnce(refusal("CHARA_FORBIDDEN"));
    expect(await saveDirectHiringRule(valid)).toEqual({ message: "You are not allowed to do this." });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("sends an administrator whose two-step verification lapsed to confirm it and back to the page", async () => {
    rpcMock.mockResolvedValueOnce(refusal("CHARA_FORBIDDEN", "aal2_required"));
    await expect(saveDirectHiringRule(valid)).rejects.toThrow(`REDIRECT:/en/mfa?next=${encodeURIComponent("/en/admin/direct-hiring-rules")}`);
  });
});

describe("deleteDirectHiringRule (FR-Q5 AC12)", () => {
  it("deletes the rule with the trimmed reason", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    expect(await deleteDirectHiringRule({ id: ID, reason: ` ${reason}` })).toEqual({ done: true });
    expect(rpcMock).toHaveBeenCalledWith("admin_delete_direct_hiring_rule", { p_rule: ID, p_reason: reason });
    expect(revalidateMock).toHaveBeenCalledWith("/en/admin/direct-hiring-rules");
  });

  it("refuses a malformed id or a short reason, and says when the rule is already gone", async () => {
    expect((await deleteDirectHiringRule({ id: "x", reason })).errors).toHaveProperty("id");
    expect((await deleteDirectHiringRule({ id: ID, reason: "short" })).errors).toHaveProperty("reason");
    expect(rpcMock).not.toHaveBeenCalled();
    rpcMock.mockResolvedValueOnce(refusal("CHARA_NOT_FOUND"));
    expect(await deleteDirectHiringRule({ id: ID, reason })).toEqual({ message: "This rule was already deleted." });
  });
});

describe("the rules and history reads (FR-Q5 AC10, AC11)", () => {
  it("maps every rule with its reference and review flag", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          id: ID,
          source_country: "PH",
          source_name: "Philippines",
          destination_country: null,
          destination_name: null,
          rule: "blocked",
          notice,
          legal_opinion_ref: "LO",
          updated_by_name: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
          review_due: true,
        },
      ],
      error: null,
    });
    expect(await listDirectHiringRules()).toEqual([
      {
        id: ID,
        sourceCountry: "PH",
        sourceName: "Philippines",
        destinationCountry: null,
        destinationName: null,
        rule: "blocked",
        notice,
        legalOpinionRef: "LO",
        updatedByName: null,
        updatedAt: "2026-01-02T00:00:00Z",
        reviewDue: true,
      },
    ]);
    expect(rpcMock).toHaveBeenCalledWith("admin_list_direct_hiring_rules");
  });

  it("maps the history and leaves out rows of another action", async () => {
    const after = { source_country: "PH", destination_country: null, rule: "blocked", notice, legal_opinion_ref: "LO" };
    rpcMock.mockResolvedValueOnce({
      data: [
        { id: 2, created_at: "2026-01-02T00:00:00Z", actor_name: "Ada", action: "direct_hiring_rule.created", rule_id: ID, before: null, after, reason },
        { id: 1, created_at: "2026-01-01T00:00:00Z", actor_name: null, action: "setting.changed", rule_id: ID, before: null, after: null, reason: null },
      ],
      error: null,
    });
    expect(await listDirectHiringRuleHistory()).toEqual([
      { id: 2, createdAt: "2026-01-02T00:00:00Z", actorName: "Ada", action: "created", before: null, after, reason },
    ]);
    expect(rpcMock).toHaveBeenCalledWith("admin_list_direct_hiring_rule_history", { p_limit: 50 });
  });

  it("throws for the error boundary when the rules cannot be read", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "permission denied", code: "42501" } });
    await expect(listDirectHiringRules()).rejects.toThrow("The direct-hiring rules could not be loaded");
  });
});
