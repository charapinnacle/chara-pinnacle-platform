import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LicenceInput } from "@/lib/validation/licences";

const rpcMock = vi.fn();
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const releasedMock = vi.hoisted(() => vi.fn());
const uploadMock = vi.hoisted(() => vi.fn());
const linkMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
vi.mock("@/lib/dal/reference", () => ({
  getCountries: async () => [
    { code: "DE", name: "Germany" },
    { code: "PH", name: "Philippines" },
  ],
}));
vi.mock("@/lib/dal/licences", () => ({
  getLicenceSettings: async () => ({ patterns: { PH: "^DMW-" }, maxYears: 20 }),
  requestEvidenceUpload: uploadMock,
  requestEvidenceLink: linkMock,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { deleteLicence, getEvidenceDownload, saveLicence, startEvidenceUpload } = await import("@/lib/actions/licences");

const LICENCE = "3f0c2a8e-7b1d-4c5e-9a2f-6d8b1e4c7a90";
const input: LicenceInput = {
  country: "ph",
  issuingAuthority: " Department of Migrant Workers ",
  licenceNumber: "DMW-123-LB-031522-R",
  validUntil: "2028-03-15",
  confirmed: true,
};
const refusal = (message: string, details: string, code = "P0001") => ({ data: null, error: { message, details, code } });

beforeEach(() => {
  vi.clearAllMocks();
  releasedMock.mockResolvedValue(true);
  requireOrgRoleMock.mockResolvedValue({ organization: { id: "org-1", type: "recruitment_company", role: "owner" } });
  rpcMock.mockResolvedValue({ data: LICENCE, error: null });
});

describe("saveLicence (FR-J2)", () => {
  it("AC1: checks an owner or admin of a partner at aal2 and adds the entry with the statement", async () => {
    expect(await saveLicence("manila-skills", null, input)).toEqual({ licenceId: LICENCE });
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "manila-skills", "admin", { hideFromOutsiders: true, partner: true });
    expect(rpcMock).toHaveBeenCalledWith("add_partner_licence", {
      p_org: "org-1",
      p_country_code: "PH",
      p_issuing_authority: "Department of Migrant Workers",
      p_licence_number: "DMW-123-LB-031522-R",
      p_valid_until: "2028-03-15",
      p_confirmed: true,
    });
  });

  it("changes an existing entry by its id, and leaves a past date to the database", async () => {
    expect(await saveLicence("manila-skills", LICENCE, { ...input, validUntil: "2020-01-01" })).toEqual({ licenceId: LICENCE });
    expect(rpcMock).toHaveBeenCalledWith("update_partner_licence", expect.objectContaining({ p_licence: LICENCE, p_valid_until: "2020-01-01" }));
  });

  it("refuses an invalid form, the release switch off and a bad id before the database is asked", async () => {
    expect(await saveLicence("manila-skills", null, { ...input, licenceNumber: "123" })).toEqual({
      errors: { licenceNumber: "This does not match the usual format of licence numbers in the Philippines" },
    });
    expect(await saveLicence("manila-skills", "not-a-uuid", input)).toHaveProperty("message");
    releasedMock.mockResolvedValue(false);
    expect(await saveLicence("manila-skills", null, input)).toEqual({ message: "Licences cannot be changed at the moment." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("AC3: shows the database's refusals at their fields", async () => {
    const cases: [ReturnType<typeof refusal>, object][] = [
      [refusal("CHARA_CONFLICT", "licence_number"), { errors: { licenceNumber: "You have already added this number for this country." } }],
      [refusal("CHARA_INVALID_INPUT", "confirmation"), { errors: { confirmed: "Confirm that this entry is accurate." } }],
      [refusal("CHARA_INVALID_INPUT", "valid_until"), { errors: { validUntil: "Choose today or a later date within the allowed range." } }],
      [refusal("insert or update violates foreign key constraint", "", "23503"), { errors: { country: "Choose a country from the list." } }],
      [refusal("CHARA_FORBIDDEN", "organization_suspended"), { message: "This organization is suspended, so its licences cannot be changed." }],
      [refusal("CHARA_NOT_FOUND", "", "P0002"), { message: "This licence no longer exists." }],
    ];
    for (const [answer, expected] of cases) {
      rpcMock.mockResolvedValueOnce(answer);
      expect(await saveLicence("manila-skills", null, input)).toEqual(expected);
    }
  });

  it("an unexpected failure gives a reference and changes nothing", async () => {
    const original = console.error;
    console.error = () => {};
    rpcMock.mockResolvedValueOnce(refusal("boom", "", "XX000"));
    try {
      expect((await saveLicence("manila-skills", null, input)).message).toMatch(/Reference: [0-9A-F]{8}\.$/);
    } finally {
      console.error = original;
    }
  });
});

describe("deleteLicence and startEvidenceUpload (FR-J2)", () => {
  it("deletes by id and treats an entry already gone as deleted", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    expect(await deleteLicence("manila-skills", LICENCE)).toEqual({});
    rpcMock.mockResolvedValueOnce(refusal("CHARA_NOT_FOUND", "", "P0002"));
    expect(await deleteLicence("manila-skills", LICENCE)).toEqual({});
    expect(rpcMock).toHaveBeenCalledWith("delete_partner_licence", { p_licence: LICENCE });
  });

  it("AC5: asks document-url for an upload URL only for an acceptable file, and says why one was refused", async () => {
    uploadMock.mockResolvedValueOnce({ path: "org/lic/file", token: "t" });
    const pdf = { name: "licence.pdf", size: 2_097_152, type: "application/pdf" };
    expect(await startEvidenceUpload("manila-skills", LICENCE, pdf)).toEqual({ upload: { path: "org/lic/file", token: "t" } });
    expect(uploadMock).toHaveBeenCalledWith(LICENCE, pdf);
    expect(await startEvidenceUpload("manila-skills", LICENCE, { name: "x.svg", size: 10, type: "image/svg+xml" })).toEqual({
      message: "Choose a PDF, JPG or PNG file.",
    });
    expect(uploadMock).toHaveBeenCalledTimes(1);
    uploadMock.mockResolvedValueOnce({ refusal: "invalid_file" });
    expect(await startEvidenceUpload("manila-skills", LICENCE, pdf)).toEqual({ message: "Choose a PDF, JPG or PNG file of up to 15 MB." });
    uploadMock.mockResolvedValueOnce({ refusal: "unavailable" });
    expect(await startEvidenceUpload("manila-skills", LICENCE, pdf)).toEqual({ message: "This licence no longer exists." });
  });

  it("gives the owner or an admin a download link of the scanned file, and says why there is none", async () => {
    linkMock.mockResolvedValueOnce({ url: "http://stack.test/storage/v1/object/sign/partner-documents/x?token=t" });
    expect(await getEvidenceDownload("manila-skills", LICENCE)).toEqual({
      url: "http://stack.test/storage/v1/object/sign/partner-documents/x?token=t",
    });
    expect(linkMock).toHaveBeenCalledWith(LICENCE);
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "manila-skills", "admin", { hideFromOutsiders: true, partner: true });
    linkMock.mockResolvedValueOnce({ refusal: "not_scanned" });
    expect(await getEvidenceDownload("manila-skills", LICENCE)).toEqual({
      message: "This file cannot be downloaded until it has been checked.",
    });
    linkMock.mockResolvedValueOnce({ refusal: "unavailable" });
    expect(await getEvidenceDownload("manila-skills", LICENCE)).toEqual({ message: "This licence no longer exists." });
    expect(await getEvidenceDownload("manila-skills", "not-a-uuid")).toHaveProperty("message");
    expect(linkMock).toHaveBeenCalledTimes(3);
  });
});
