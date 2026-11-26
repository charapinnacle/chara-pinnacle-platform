import { beforeEach, describe, expect, it, vi } from "vitest";
import { standardTermsLines, standardTermsSchema, trackRecordLines, trackRecordSchema } from "@/lib/partners/terms-and-record";

const rpcMock = vi.fn();
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const kindMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/workforce-offer", () => ({ getPartnerKind: kindMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { saveStandardTerms, saveTrackRecord } = await import("@/lib/actions/partner-terms");

const terms = { feeModel: "fee_per_hire", feeAmount: "1500", feeCurrency: "eur", guaranteeDays: "90", minAssignmentWeeks: "", note: "" };

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  kindMock.mockResolvedValue("recruitment");
  requireOrgRoleMock.mockResolvedValue({
    organization: { id: "org-1", slug: "manila-skills", type: "recruitment_company", role: "owner" },
  });
  rpcMock.mockResolvedValue({ data: null, error: null });
});

describe("standardTermsSchema", () => {
  it("allows only the fee models of the kind", () => {
    expect(standardTermsSchema("recruitment").safeParse(terms).success).toBe(true);
    expect(standardTermsSchema("staffing").safeParse(terms).success).toBe(false);
    expect(standardTermsSchema("staffing").safeParse({ ...terms, feeModel: "hourly_rate" }).success).toBe(true);
  });

  it("asks for an amount and currency where the fee has them, and a percentage up to 100", () => {
    const schema = standardTermsSchema("recruitment");
    expect(schema.safeParse({ ...terms, feeAmount: "" }).success).toBe(false);
    expect(schema.safeParse({ ...terms, feeCurrency: "" }).success).toBe(false);
    expect(schema.safeParse({ ...terms, feeModel: "percent_first_year_salary", feeAmount: "101", feeCurrency: "" }).success).toBe(false);
    expect(schema.safeParse({ ...terms, feeModel: "on_request", feeAmount: "", feeCurrency: "" }).success).toBe(true);
  });

  it("keeps the guarantee within a year and the note on one line", () => {
    const schema = standardTermsSchema("recruitment");
    expect(schema.safeParse({ ...terms, guaranteeDays: "366" }).success).toBe(false);
    expect(schema.safeParse({ ...terms, note: "a\nb" }).success).toBe(false);
  });
});

describe("trackRecordSchema", () => {
  it("takes a whole number of placements and country codes", () => {
    expect(trackRecordSchema.safeParse({ placementsLastYear: "120", countriesPlaced: ["DE"] }).success).toBe(true);
    expect(trackRecordSchema.safeParse({ placementsLastYear: "1.5", countriesPlaced: [] }).success).toBe(false);
    expect(trackRecordSchema.safeParse({ placementsLastYear: "", countriesPlaced: [] }).success).toBe(true);
  });
});

describe("the lines of the public profile", () => {
  it("states the fee, the guarantee, the shortest assignment and the note", () => {
    expect(
      standardTermsLines({
        feeModel: "fee_per_hire",
        feeAmount: 1500,
        feeCurrency: "EUR",
        guaranteeDays: 90,
        minAssignmentWeeks: null,
        note: "Visa included",
      }),
    ).toEqual(["EUR 1,500.00 per hire", "Free replacement within 90 days", "Visa included"]);
    expect(
      standardTermsLines({
        feeModel: "hourly_rate",
        feeAmount: 18.5,
        feeCurrency: "EUR",
        guaranteeDays: null,
        minAssignmentWeeks: 1,
        note: null,
      }),
    ).toEqual(["EUR 18.50 per hour", "Shortest assignment 1 week"]);
  });

  it("states the record the company gives, and nothing without one", () => {
    const record = { placementsLastYear: 120, countriesPlaced: [{ code: "DE", name: "Germany" }], platformHires: 3 };
    expect(trackRecordLines(record)).toEqual(["120 workers placed in the last 12 months", "Placed in Germany"]);
    expect(trackRecordLines({ placementsLastYear: null, countriesPlaced: [], platformHires: 0 })).toEqual([]);
  });
});

describe("saveStandardTerms and saveTrackRecord", () => {
  it("check an owner or admin of a partner and send the terms of the kind", async () => {
    await expect(saveStandardTerms("manila-skills", terms)).resolves.toEqual({ saved: true });
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "manila-skills", "admin", { hideFromOutsiders: true, partner: true });
    expect(rpcMock).toHaveBeenCalledWith("set_partner_standard_terms", {
      p_org: "org-1",
      p_fee_model: "fee_per_hire",
      p_fee_amount: 1500,
      p_fee_currency: "EUR",
      p_guarantee_days: 90,
      p_min_assignment_weeks: undefined,
      p_note: undefined,
    });
  });

  it("send nothing while the release is off or the input is wrong", async () => {
    releasedMock.mockResolvedValue(false);
    await expect(saveTrackRecord("manila-skills", { placementsLastYear: "1", countriesPlaced: [] })).resolves.toEqual({
      message: expect.any(String),
    });
    releasedMock.mockResolvedValue(true);
    kindMock.mockResolvedValue("staffing");
    await expect(saveStandardTerms("manila-skills", terms)).resolves.toEqual({ errors: { feeModel: expect.any(String) } });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("show a refused value at its field", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_INVALID_INPUT", details: "countries_placed", code: "P0001" } });
    await expect(saveTrackRecord("manila-skills", { placementsLastYear: "120", countriesPlaced: ["DE"] })).resolves.toEqual({
      errors: { countriesPlaced: "Choose countries from the list." },
    });
    expect(rpcMock).toHaveBeenCalledWith("set_partner_track_record", {
      p_org: "org-1",
      p_placements_last_year: 120,
      p_countries_placed: ["DE"],
    });
  });
});
