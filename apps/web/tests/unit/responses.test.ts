import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  documentsLimitText,
  feeText,
  isLive,
  partnerStatusLabels,
  responseStatuses,
  versionChangeLines,
  type ResponseVersion,
} from "@/lib/responses/presentation";
import { documentRefusalMessage, documentRefusals, RESPONSE_MESSAGES, responseRefusal, withdrawRefusal } from "@/lib/responses/refusal";
import {
  AMOUNT_REQUIRED,
  AVAILABLE_FROM_LATE,
  AVAILABLE_FROM_PAST,
  CAPACITY_WHOLE,
  CURRENCY_REQUIRED,
  documentFileIssue,
  DOCUMENT_NAME,
  DOCUMENT_NOT_PDF,
  DOCUMENT_TOO_LARGE,
  EXPERIENCE_TEXT,
  FEE_MODEL_REQUIRED,
  PERCENT_RANGE,
  responseFormSchema,
  toleranceFormSchema,
  toResponseArgs,
  withdrawFormSchema,
  type ResponseFormInput,
} from "@/lib/validation/response";
import { fieldErrors } from "@/lib/validation/sign-up";

const rpcMock = vi.fn();
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const promptsMock = vi.hoisted(() => vi.fn());
const countriesMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock, getCurrentUser: vi.fn() }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/usage", () => ({ getUsagePrompts: promptsMock }));
vi.mock("@/lib/dal/reference", () => ({ getCountries: countriesMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { respondToRequirement, setCapacityTolerance, updateMyResponse, withdrawMyResponse } = await import("@/lib/actions/responses");

const TODAY = "2026-10-17";
const schema = responseFormSchema({ maxCapacity: 100, today: TODAY });
const REQUIREMENT = "3f0c2a8e-7b1d-4c5e-9a2f-6d8b1e4c7a90";
const RESPONSE = "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f";
const PARTNER = { id: "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", slug: "p1", type: "recruitment_company", role: "member", suspended: false };
const refusal = (message: string, details: string | null, code = "P0001") => ({ data: null, error: { message, details, code } });

// The response of FR-O2 AC1.
const valid: ResponseFormInput = {
  capacity: "80",
  availableFrom: "2027-01-10",
  timelineNote: "First 40 workers in January, the rest by March",
  experienceNote: "x".repeat(300),
  feeModel: "fee_per_hire",
  feeAmount: "1500.00",
  feeCurrency: "EUR",
  notes: "n".repeat(200),
};

function errorsFor(values: Partial<Record<keyof ResponseFormInput, unknown>>, options = schema): Record<string, string> {
  const result = options.safeParse({ ...valid, ...values });
  return result.success ? {} : fieldErrors(result.error);
}

describe("the response form schema (FR-O2 AC2)", () => {
  it("accepts the response of AC1", () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it("takes a whole number of workers of at least 1", () => {
    expect(errorsFor({ capacity: "0" }).capacity).toBe(CAPACITY_WHOLE);
    expect(errorsFor({ capacity: "1" }).capacity).toBeUndefined();
    expect(errorsFor({ capacity: "1.5" }).capacity).toBe(CAPACITY_WHOLE);
    expect(errorsFor({ capacity: "" }).capacity).toBe("Enter the number of workers you can supply.");
  });

  it("keeps the capacity within the employer's tolerance (AC4), but keeps an unchanged one on edit", () => {
    expect(errorsFor({ capacity: "100" }).capacity).toBeUndefined();
    expect(errorsFor({ capacity: "101" }).capacity).toBe("You can offer at most 100 workers.");
    const tolerant = responseFormSchema({ maxCapacity: 110, today: TODAY });
    expect(errorsFor({ capacity: "110" }, tolerant).capacity).toBeUndefined();
    expect(errorsFor({ capacity: "111" }, tolerant).capacity).toBe("You can offer at most 110 workers.");
    const kept = responseFormSchema({ maxCapacity: 90, today: TODAY, kept: { capacity: 95, availableFrom: "2026-10-01" } });
    expect(errorsFor({ capacity: "95", availableFrom: "2026-10-01" }, kept)).toEqual({});
    expect(errorsFor({ capacity: "96" }, kept).capacity).toBe("You can offer at most 90 workers.");
  });

  it("takes an available date from today to 3 years ahead", () => {
    expect(errorsFor({ availableFrom: "2026-10-16" }).availableFrom).toBe(AVAILABLE_FROM_PAST);
    expect(errorsFor({ availableFrom: TODAY }).availableFrom).toBeUndefined();
    expect(errorsFor({ availableFrom: "2029-10-17" }).availableFrom).toBeUndefined();
    expect(errorsFor({ availableFrom: "2029-10-18" }).availableFrom).toBe(AVAILABLE_FROM_LATE);
    expect(errorsFor({ availableFrom: "2026-02-30" }).availableFrom).toBe("Choose a valid date.");
  });

  it("bounds the texts after trimming", () => {
    expect(errorsFor({ timelineNote: "t".repeat(1000) }).timelineNote).toBeUndefined();
    expect(errorsFor({ timelineNote: "t".repeat(1001) }).timelineNote).toBe("The timeline must have 1,000 characters or fewer.");
    expect(errorsFor({ experienceNote: "e".repeat(19) }).experienceNote).toBe(EXPERIENCE_TEXT);
    expect(errorsFor({ experienceNote: "e".repeat(20) }).experienceNote).toBeUndefined();
    expect(errorsFor({ experienceNote: "e".repeat(4000) }).experienceNote).toBeUndefined();
    expect(errorsFor({ experienceNote: "e".repeat(4001) }).experienceNote).toBe(EXPERIENCE_TEXT);
    expect(errorsFor({ experienceNote: " ".repeat(30) }).experienceNote).toBe(EXPERIENCE_TEXT);
    expect(errorsFor({ notes: "n".repeat(2000) }).notes).toBeUndefined();
    expect(errorsFor({ notes: "n".repeat(2001) }).notes).toBe("The notes must have 2,000 characters or fewer.");
    expect(errorsFor({ notes: "line one\nline two\ttab" }).notes).toBeUndefined();
    expect(errorsFor({ notes: "bell\u0007" }).notes).toBe("Remove the special characters.");
  });

  it("refuses a fee model that is not in the list", () => {
    expect(errorsFor({ feeModel: "commission" }).feeModel).toBe(FEE_MODEL_REQUIRED);
    expect(errorsFor({ feeModel: "" }).feeModel).toBe(FEE_MODEL_REQUIRED);
  });

  it("asks for the amount and currency the fee model needs (AC3)", () => {
    expect(errorsFor({ feeAmount: "" }).feeAmount).toBe(AMOUNT_REQUIRED);
    expect(errorsFor({ feeCurrency: "" }).feeCurrency).toBe(CURRENCY_REQUIRED);
    expect(errorsFor({ feeAmount: "-1" }).feeAmount).toBeDefined();
    expect(errorsFor({ feeAmount: "10000000" }).feeAmount).toBe("The amount cannot be more than 9,999,999.99.");
    expect(errorsFor({ feeAmount: "15.555" }).feeAmount).toBeDefined();
    expect(errorsFor({ feeModel: "hourly_rate", feeAmount: "18.50", feeCurrency: "usd" })).toEqual({});
    const percent = { feeModel: "percent_first_year_salary", feeCurrency: "" };
    expect(errorsFor({ ...percent, feeAmount: "12.5" })).toEqual({});
    expect(errorsFor({ ...percent, feeAmount: "0" }).feeAmount).toBe(PERCENT_RANGE);
    expect(errorsFor({ ...percent, feeAmount: "100.01" }).feeAmount).toBe(PERCENT_RANGE);
    expect(errorsFor({ feeModel: "on_request", feeAmount: "", feeCurrency: "" })).toEqual({});
  });

  it("maps a payload without status, version or organization_id, and only the fee fields the model has", () => {
    const parsed = schema.parse({ ...valid, status: "selected", version: 9, organization_id: "x" });
    const args = toResponseArgs(parsed);
    expect(args).toEqual({
      p_capacity: 80,
      p_available_from: "2027-01-10",
      p_experience_note: "x".repeat(300),
      p_fee_model: "fee_per_hire",
      p_fee_amount: 1500,
      p_fee_currency: "EUR",
      p_timeline_note: "First 40 workers in January, the rest by March",
      p_notes: "n".repeat(200),
    });
    expect(Object.keys(args).some((key) => /status|version|organization/.test(key))).toBe(false);
    const percent = toResponseArgs(schema.parse({ ...valid, feeModel: "percent_first_year_salary", feeAmount: "12.5", feeCurrency: "EUR" }));
    expect(percent.p_fee_currency).toBeUndefined();
    const request = toResponseArgs(schema.parse({ ...valid, feeModel: "on_request", feeAmount: "5", feeCurrency: "EUR", notes: "", timelineNote: "" }));
    expect([request.p_fee_amount, request.p_fee_currency, request.p_notes, request.p_timeline_note]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("bounds the withdrawal reason and the tolerance", () => {
    expect(withdrawFormSchema.safeParse({ reason: "r".repeat(500) }).success).toBe(true);
    expect(withdrawFormSchema.safeParse({ reason: "r".repeat(501) }).success).toBe(false);
    expect(toleranceFormSchema.safeParse({ percent: "0" }).success).toBe(true);
    expect(toleranceFormSchema.safeParse({ percent: "100" }).success).toBe(true);
    expect(toleranceFormSchema.safeParse({ percent: "101" }).success).toBe(false);
    expect(toleranceFormSchema.safeParse({ percent: "2.5" }).success).toBe(false);
  });
});

describe("the documents checked before an upload (FR-O2 AC5)", () => {
  const pdf = (size: number, name = "proposal.pdf", type = "application/pdf") => ({ name, size, type });
  it("refuses a sixth file, a file over 15 MB, a non-PDF and a bad name", () => {
    expect(documentFileIssue(pdf(2_000_000), 4, 5)).toBeNull();
    expect(documentFileIssue(pdf(2_000_000), 5, 5)).toBe("You can attach up to five documents.");
    expect(documentFileIssue(pdf(15 * 1024 * 1024), 0, 5)).toBeNull();
    expect(documentFileIssue(pdf(15 * 1024 * 1024 + 1), 0, 5)).toBe(DOCUMENT_TOO_LARGE);
    expect(documentFileIssue(pdf(10, "photo.png", "image/png"), 0, 5)).toBe(DOCUMENT_NOT_PDF);
    expect(documentFileIssue(pdf(10, `${"a".repeat(117)}.pdf`), 0, 5)).toBe(DOCUMENT_NAME);
    expect(documentFileIssue(pdf(10, "a.pdf"), 0, 5)).toBeNull();
  });
  it("names the limit the administrator set", () => {
    expect(documentsLimitText(5)).toBe("You can attach up to five documents");
    expect(documentsLimitText(1)).toBe("You can attach one document");
    expect(documentsLimitText(20)).toBe("You can attach up to twenty documents");
  });
});

describe("the refusals of the response functions in words", () => {
  it("puts a refused field at its field", () => {
    expect(responseRefusal({ message: "CHARA_INVALID_INPUT", details: "capacity_above_allowed:100" })).toEqual({
      kind: "field",
      field: "capacity",
      message: "You can offer at most 100 workers.",
    });
    expect(responseRefusal({ message: "CHARA_INVALID_INPUT", details: "experience_note" })).toMatchObject({ field: "experienceNote" });
    expect(responseRefusal({ code: "23514", message: "new row violates check constraint" })).toMatchObject({ field: "feeAmount" });
    expect(responseRefusal({ code: "23503", message: "insert or update violates foreign key" })).toMatchObject({ field: "feeCurrency" });
    expect(responseRefusal({ message: "CHARA_INVALID_INPUT", details: "something_else" })).toEqual({ kind: "fault" });
  });

  it("names the missing condition and the states (FR-N2 AC2, AC5, AC10, FR-J2 AC10)", () => {
    expect(responseRefusal({ message: "CHARA_LIMIT_REACHED", details: "job_order_responses_per_month" })).toEqual({ kind: "limit" });
    expect(responseRefusal({ message: "CHARA_LICENCE_REQUIRED", details: "DE" })).toEqual({ kind: "licence", country: "DE" });
    expect(responseRefusal({ message: "CHARA_CONSENT_REQUIRED", details: "employer-pays-commitment" })).toEqual({
      kind: "message",
      message: RESPONSE_MESSAGES.commitment,
    });
    expect(responseRefusal({ message: "CHARA_FEATURE_NOT_IN_PLAN", details: "job_order_access" })).toMatchObject({ message: RESPONSE_MESSAGES.plan });
    expect(responseRefusal({ message: "CHARA_FORBIDDEN", details: "served_country_missing", code: "42501" })).toMatchObject({
      message: RESPONSE_MESSAGES.conditions,
    });
    expect(responseRefusal({ message: "CHARA_CONFLICT", details: "already_responded" })).toMatchObject({ message: RESPONSE_MESSAGES.alreadyResponded });
    expect(responseRefusal({ message: "CHARA_CONFLICT", details: "stale" })).toMatchObject({ message: RESPONSE_MESSAGES.stale });
    expect(responseRefusal({ message: "CHARA_INVALID_STATE", details: "requirement_not_open" })).toMatchObject({ message: RESPONSE_MESSAGES.notOpen });
    expect(responseRefusal({ message: "CHARA_INVALID_STATE", details: "shortlisted" })).toMatchObject({
      message: "This response is shortlisted and can no longer be changed. Reload the page.",
    });
    expect(responseRefusal({ message: "CHARA_NOT_FOUND", details: null, code: "P0002" })).toMatchObject({ message: RESPONSE_MESSAGES.notFound });
    expect(responseRefusal({ message: "boom", details: null, code: "XX000" })).toEqual({ kind: "fault" });
  });

  it("says a document is still being checked (FR-O2 AC5)", () => {
    expect(responseRefusal({ message: "CHARA_DOCUMENT_NOT_SCANNED", details: "scanning" })).toEqual({
      kind: "message",
      message: "A document is still being checked, try again in a minute.",
    });
    expect(responseRefusal({ message: "CHARA_DOCUMENT_NOT_SCANNED", details: "upload_missing" })).toMatchObject({
      message: RESPONSE_MESSAGES.uploadMissing,
    });
  });

  it("maps the withdrawal's refusals", () => {
    expect(withdrawRefusal({ message: "CHARA_INVALID_INPUT", details: "p_reason" })).toEqual({ kind: "field", message: RESPONSE_MESSAGES.reason });
    expect(withdrawRefusal({ message: "CHARA_INVALID_STATE", details: "selected" })).toMatchObject({
      message: "This response is selected and can no longer be withdrawn. Reload the page.",
    });
    expect(withdrawRefusal({ message: "CHARA_NOT_FOUND", details: null, code: "P0002" })).toMatchObject({ message: RESPONSE_MESSAGES.responseNotFound });
  });

  it("has words for every answer of document-url", () => {
    for (const answer of documentRefusals) expect(documentRefusalMessage(answer, "You can attach up to five documents")).not.toBe("");
    expect(documentRefusalMessage("documents_limit", "You can attach up to five documents")).toBe("You can attach up to five documents.");
  });
});

describe("the response in words", () => {
  it("writes the fee as the partner entered it", () => {
    expect(feeText("fee_per_hire", 1500, "EUR")).toBe("EUR 1,500.00 per hire");
    expect(feeText("percent_first_year_salary", 12.5, null)).toBe("12.5% of first-year salary");
    expect(feeText("hourly_rate", 18.5, "USD")).toBe("USD 18.50 per hour");
    expect(feeText("monthly_rate", 3200, "EUR")).toBe("EUR 3,200.00 per month");
    expect(feeText("on_request", null, null)).toBe("On request");
  });

  it("lists what a version changed (FR-O2 AC9: fee 1500 to 1400 EUR, capacity 80 to 90)", () => {
    const payload = { capacity: 80, availableFrom: "2027-01-10", timelineNote: null, experienceNote: "x", feeModel: "fee_per_hire" as const, feeAmount: 1500, feeCurrency: "EUR", notes: null };
    const first: ResponseVersion = { version: 1, createdAt: "2026-10-17T10:00:00Z", changedFields: [], payload };
    const second: ResponseVersion = {
      version: 2,
      createdAt: "2026-10-18T10:00:00Z",
      changedFields: ["capacity", "fee_amount"],
      payload: { ...payload, capacity: 90, feeAmount: 1400 },
    };
    expect(versionChangeLines(first, undefined)).toEqual([]);
    expect(versionChangeLines(second, first)).toEqual([
      { label: "Workers offered", before: "80 workers", after: "90 workers" },
      { label: "Fee", before: "EUR 1,500.00 per hire", after: "EUR 1,400.00 per hire" },
    ]);
  });

  it("allows change and withdrawal only until the employer decides", () => {
    expect(responseStatuses.filter(isLive)).toEqual(["submitted", "updated"]);
    expect(Object.keys(partnerStatusLabels).sort()).toEqual([...responseStatuses].sort());
  });
});

describe("the response actions", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    promptsMock.mockReset();
    releasedMock.mockResolvedValue(true);
    requireOrgRoleMock.mockResolvedValue({ user: { id: "u" }, organization: PARTNER });
    countriesMock.mockResolvedValue([{ code: "DE", name: "Germany" }]);
  });

  it("sends the parsed proposal and answers the response id", async () => {
    rpcMock.mockResolvedValue({ data: RESPONSE, error: null });
    expect(await respondToRequirement("p1", REQUIREMENT, valid)).toEqual({ responseId: RESPONSE });
    expect(rpcMock).toHaveBeenCalledWith("respond_to_invitation", expect.objectContaining({ p_org: PARTNER.id, p_requirement: REQUIREMENT, p_capacity: 80 }));
  });

  it("returns field errors without calling the database", async () => {
    const result = await respondToRequirement("p1", REQUIREMENT, { ...valid, experienceNote: "", capacity: "0" });
    expect(result.errors).toMatchObject({ capacity: CAPACITY_WHOLE, experienceNote: EXPERIENCE_TEXT });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("answers the monthly limit with the upgrade prompt and a licence with the country's name", async () => {
    const prompt = { limitKey: "job_order_responses_per_month", used: 10, limit: 10, resetsAt: null, planName: "Partner", comparison: null };
    promptsMock.mockResolvedValue({ job_order_responses_per_month: prompt });
    rpcMock.mockResolvedValue(refusal("CHARA_LIMIT_REACHED", "job_order_responses_per_month"));
    expect(await respondToRequirement("p1", REQUIREMENT, valid)).toEqual({ limitReached: prompt });
    rpcMock.mockResolvedValue(refusal("CHARA_LICENCE_REQUIRED", "DE"));
    expect(await respondToRequirement("p1", REQUIREMENT, valid)).toEqual({ message: "A licence for Germany is required to respond to this job order." });
  });

  it("refuses everything while release 2b is off", async () => {
    releasedMock.mockResolvedValue(false);
    expect(await respondToRequirement("p1", REQUIREMENT, valid)).toEqual({ message: RESPONSE_MESSAGES.releaseOff });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sends the expected version with an edit and says when it is stale", async () => {
    rpcMock.mockResolvedValue(refusal("CHARA_CONFLICT", "stale"));
    expect(await updateMyResponse("p1", { responseId: RESPONSE, expectedVersion: 1 }, valid)).toEqual({ message: RESPONSE_MESSAGES.stale });
    expect(rpcMock).toHaveBeenCalledWith("update_response", expect.objectContaining({ p_response: RESPONSE, p_expected_version: 1 }));
  });

  it("withdraws with the reason, or without one when it is empty", async () => {
    rpcMock.mockResolvedValue({ data: "withdrawn", error: null });
    expect(await withdrawMyResponse("p1", RESPONSE, { reason: "  Capacity no longer available  " })).toEqual({ done: true });
    expect(rpcMock).toHaveBeenLastCalledWith("withdraw_response", { p_org: PARTNER.id, p_response: RESPONSE, p_reason: "Capacity no longer available" });
    await withdrawMyResponse("p1", RESPONSE, { reason: "" });
    expect(rpcMock).toHaveBeenLastCalledWith("withdraw_response", { p_org: PARTNER.id, p_response: RESPONSE, p_reason: undefined });
  });

  it("sets the capacity tolerance for an owner or admin", async () => {
    requireOrgRoleMock.mockResolvedValue({ user: { id: "u" }, organization: { ...PARTNER, type: "employer", role: "owner" } });
    rpcMock.mockResolvedValue({ data: true, error: null });
    expect(await setCapacityTolerance("acme", REQUIREMENT, { percent: "10" })).toEqual({ changed: true });
    expect(rpcMock).toHaveBeenCalledWith("set_requirement_capacity_tolerance", { p_org: PARTNER.id, p_requirement: REQUIREMENT, p_percent: 10 });
    expect(await setCapacityTolerance("acme", REQUIREMENT, { percent: "101" })).toMatchObject({ errors: { percent: expect.any(String) } });
  });
});
