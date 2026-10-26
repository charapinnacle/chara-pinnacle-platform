import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListingInput } from "@/lib/validation/workforce-availability";

const rpcMock = vi.fn();
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { confirmListing, deleteListing, saveListing } = await import("@/lib/actions/workforce-availability");

const LISTING = "3f0c2a8e-7b1d-4c5e-9a2f-6d8b1e4c7a90";
const input: ListingInput = { occupation: "7212", country: "ph", available: " 120 ", monthlyCapacity: "40", availableFrom: "2027-03-01" };
const refusal = (message: string, details: string, code = "P0001") => ({ data: null, error: { message, details, code } });

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  requireOrgRoleMock.mockResolvedValue({ organization: { id: "org-1", type: "staffing_company", role: "owner" } });
  rpcMock.mockResolvedValue({ data: LISTING, error: null });
});

describe("saveListing (FR-K3)", () => {
  it("AC1: checks an owner or admin of a partner at aal2 and adds the listing with numbers", async () => {
    expect(await saveListing("manila-skills", null, input)).toEqual({ saved: true });
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "manila-skills", "admin", { hideFromOutsiders: true, partner: true });
    expect(rpcMock).toHaveBeenCalledWith("add_workforce_availability", {
      p_org: "org-1",
      p_occupation_id: "7212",
      p_source_country: "PH",
      p_available: 120,
      p_monthly_capacity: 40,
      p_available_from: "2027-03-01",
    });
  });

  it("changes the numbers and date of a saved listing by its id, and leaves the date bound to the database", async () => {
    expect(await saveListing("manila-skills", LISTING, { ...input, availableFrom: "2099-01-01" })).toEqual({ saved: true });
    expect(rpcMock).toHaveBeenCalledWith("update_workforce_availability", {
      p_listing: LISTING,
      p_available: 120,
      p_monthly_capacity: 40,
      p_available_from: "2099-01-01",
    });
  });

  it("refuses an invalid form, the release switch off and a bad id before the database is asked", async () => {
    expect(await saveListing("manila-skills", null, { ...input, available: "0" })).toEqual({
      errors: { available: "Enter a whole number from 1 to 100,000." },
    });
    expect(await saveListing("manila-skills", "not-a-uuid", input)).toHaveProperty("message");
    expect(await saveListing("Not A Slug!", null, input)).toHaveProperty("message");
    releasedMock.mockResolvedValue(false);
    expect(await saveListing("manila-skills", null, input)).toEqual({ message: "Availability cannot be changed at the moment." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("AC2, AC3: shows the database's refusals at their fields or as a message", async () => {
    const cases: [ReturnType<typeof refusal>, object][] = [
      [refusal("CHARA_INVALID_INPUT", "occupation_not_in_profile"), { errors: { occupation: "Choose one of the occupations you offer." } }],
      [refusal("CHARA_INVALID_INPUT", "source_country_not_in_profile"), { errors: { country: "Choose one of the countries you source workers from." } }],
      [refusal("CHARA_INVALID_INPUT", "available_from"), { errors: { availableFrom: "Choose a date within the allowed range." } }],
      [refusal("CHARA_CONFLICT", "listing"), { errors: { country: "You already list this occupation from this country." } }],
      [refusal("CHARA_LIMIT_REACHED", "workforce_listings"), { message: "Your plan's limit of availability listings is reached. Upgrade to add more." }],
      [refusal("CHARA_FORBIDDEN", "organization_suspended"), { message: "This organization is suspended, so its availability cannot be changed." }],
      [refusal("CHARA_FORBIDDEN", "release_off"), { message: "Availability cannot be changed at the moment." }],
      [refusal("CHARA_NOT_FOUND", "", "P0002"), { message: "This listing no longer exists." }],
    ];
    for (const [answer, expected] of cases) {
      rpcMock.mockResolvedValueOnce(answer);
      expect(await saveListing("manila-skills", null, input)).toEqual(expected);
    }
  });

  it("an unexpected failure gives a reference", async () => {
    const original = console.error;
    console.error = () => {};
    rpcMock.mockResolvedValueOnce(refusal("boom", "", "XX000"));
    try {
      expect((await saveListing("manila-skills", null, input)).message).toMatch(/Reference: [0-9A-F]{8}\.$/);
    } finally {
      console.error = original;
    }
  });
});

describe("confirmListing and deleteListing (FR-K3 AC4, AC6, AC10)", () => {
  it("confirms by id and says why a confirmation was refused", async () => {
    expect(await confirmListing("manila-skills", LISTING)).toEqual({});
    expect(rpcMock).toHaveBeenCalledWith("confirm_workforce_availability", { p_listing: LISTING });
    rpcMock.mockResolvedValueOnce(refusal("CHARA_NOT_FOUND", "", "P0002"));
    expect(await confirmListing("manila-skills", LISTING)).toEqual({ message: "This listing no longer exists." });
    expect(await confirmListing("manila-skills", "x")).toHaveProperty("message");
  });

  it("deletes by id and treats a listing already gone as deleted", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    expect(await deleteListing("manila-skills", LISTING)).toEqual({});
    rpcMock.mockResolvedValueOnce(refusal("CHARA_NOT_FOUND", "", "P0002"));
    expect(await deleteListing("manila-skills", LISTING)).toEqual({});
    rpcMock.mockResolvedValueOnce(refusal("CHARA_FORBIDDEN", "organization_suspended"));
    expect(await deleteListing("manila-skills", LISTING)).toEqual({
      message: "This organization is suspended, so its availability cannot be changed.",
    });
    expect(rpcMock).toHaveBeenCalledWith("delete_workforce_availability", { p_listing: LISTING });
  });

  it("asks nothing while the release is off", async () => {
    releasedMock.mockResolvedValue(false);
    expect(await confirmListing("manila-skills", LISTING)).toEqual({ message: "Availability cannot be changed at the moment." });
    expect(await deleteListing("manila-skills", LISTING)).toEqual({ message: "Availability cannot be changed at the moment." });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
