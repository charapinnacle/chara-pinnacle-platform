import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobFormInput } from "@/lib/validation/job";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const insertMock = vi.fn();
const rpcMock = vi.fn();
const singleMock = vi.fn();
const selectMock = vi.fn(() => ({ single: singleMock }));
const revalidatePathMock = vi.hoisted(() => vi.fn());
const updateMock = vi.fn();
const maybeSingleMock = vi.fn();
const eqMock = vi.fn();
const isMock = vi.fn();
const columnsMock = vi.fn();
const chain = {
  eq: (...args: unknown[]) => {
    eqMock(...args);
    return chain;
  },
  is: (...args: unknown[]) => {
    isMock(...args);
    return chain;
  },
  select: (columns: string) => {
    columnsMock(columns);
    return chain;
  },
  maybeSingle: () => maybeSingleMock(),
};

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => ({
      insert: (row: unknown) => {
        insertMock(table, row);
        return { select: selectMock };
      },
      update: (values: unknown) => {
        updateMock(table, values);
        return chain;
      },
      select: (columns: string) => {
        columnsMock(columns);
        return chain;
      },
    }),
    rpc: rpcMock,
  }),
}));

const { changeJobStatus, createJob, reportInvalidJobForm } = await import("@/lib/actions/jobs");

const orgId = "0a1b2c3d-0000-4000-8000-000000000001";
const jobId = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const input: JobFormInput = {
  title: "  Welder MIG/MAG ",
  description: "d".repeat(120),
  occupation: "7212",
  industry: "c",
  country: "de",
  city: "Hamburg",
  employmentType: "full_time",
  salaryMin: "2800",
  salaryMax: "3400",
  salaryCurrency: "eur",
  salaryPeriod: "month",
  accommodation: true,
  visaSupport: false,
  recruitmentPreference: "both",
};

function refusal(message: string, code: string) {
  return { data: null, error: { message, code, details: null } };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgRoleMock.mockResolvedValue({ user: { id: "u" }, organization: { id: orgId, slug: "acme-bau", role: "admin" } });
  singleMock.mockResolvedValue({ data: { id: jobId }, error: null });
  rpcMock.mockResolvedValue({ data: null, error: null });
  maybeSingleMock.mockResolvedValue({ data: { id: jobId }, error: null });
});

describe("createJob", () => {
  it("checks the role of the slug first, inserts only the writable columns and goes to the vacancy page", async () => {
    await expect(createJob("acme-bau", input)).rejects.toThrow(`REDIRECT:/en/org/acme-bau/jobs/${jobId}`);
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme-bau", "admin", { mfa: false, hideFromOutsiders: true });
    expect(insertMock).toHaveBeenCalledWith("jobs", {
      organization_id: orgId,
      title: "Welder MIG/MAG",
      description: "d".repeat(120),
      occupation_id: "7212",
      industry_code: "C",
      country_code: "DE",
      city: "Hamburg",
      employment_type: "full_time",
      salary_min: 2800,
      salary_max: 3400,
      salary_currency: "EUR",
      salary_period: "month",
      accommodation: true,
      visa_support: false,
      recruitment_preference: "both",
    });
    expect(selectMock).toHaveBeenCalledWith("id");
  });

  it("takes the organization from the membership and ignores one in the input", async () => {
    await expect(
      createJob("acme-bau", { ...input, organization_id: "another", status: "open", created_by: "x" } as JobFormInput),
    ).rejects.toThrow("REDIRECT");
    const row = insertMock.mock.calls[0][1];
    expect(row.organization_id).toBe(orgId);
    expect(row).not.toHaveProperty("status");
    expect(row).not.toHaveProperty("created_by");
  });

  it("refuses a slug that is not a slug without looking the organization up", async () => {
    await expect(createJob("../Acme", input)).resolves.toEqual({
      message: "We could not complete this request. Try again.",
    });
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns a message for every field of an invalid input and does not insert", async () => {
    const result = await createJob("acme-bau", { ...input, title: "", city: "", salaryMin: "5000", salaryMax: "4000" });
    expect(Object.keys(result?.errors ?? {}).sort()).toEqual(["city", "salaryMin", "title"]);
    expect(insertMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("record_job_form_invalid", { p_org: orgId, p_fields: ["title", "city", "salaryMin"] });
  });

  it("records no refusal for an input that is not an object, and still answers with the errors", async () => {
    const result = await createJob("acme-bau", null as unknown as JobFormInput);
    expect(result?.errors).toBeDefined();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not fail the person when the refusal cannot be recorded", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpcMock.mockResolvedValue({ data: null, error: { code: "P0001", message: "CHARA_FORBIDDEN" } });
    const result = await createJob("acme-bau", { ...input, title: "" });
    expect(Object.keys(result?.errors ?? {})).toEqual(["title"]);
    log.mockRestore();
  });

  it("does not run the validation for a caller the role check refused", async () => {
    requireOrgRoleMock.mockRejectedValue(new Error("REDIRECT:/en/forbidden"));
    await expect(createJob("acme-bau", { ...input, title: "" })).rejects.toThrow("REDIRECT:/en/forbidden");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it.each([
    ['violates check constraint "jobs_salary_order"', "23514", "salaryMin", "The minimum salary cannot be higher than the maximum."],
    ['violates foreign key constraint "jobs_occupation_id_fkey"', "23503", "occupation", "Select an occupation from the list."],
    ['violates foreign key constraint "jobs_industry_code_fkey"', "23503", "industry", "Select an industry from the list."],
    ['violates foreign key constraint "jobs_country_code_fkey"', "23503", "country", "Select a country from the list."],
    ['violates foreign key constraint "jobs_salary_currency_fkey"', "23503", "salaryCurrency", "Select a currency from the list."],
    ['violates check constraint "jobs_title_check"', "23514", "title", "Check this value."],
  ])("shows a database refusal (%s) next to its field", async (message, code, field, text) => {
    singleMock.mockResolvedValue(refusal(`new row for relation "jobs" ${message}`, code));
    await expect(createJob("acme-bau", input)).resolves.toEqual({ errors: { [field]: text } });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("record_job_form_invalid", { p_org: orgId, p_fields: [field] });
  });

  it("says the caller may not create vacancies when row level security refuses, and reveals nothing else", async () => {
    singleMock.mockResolvedValue(refusal('new row violates row-level security policy for table "jobs"', "42501"));
    await expect(createJob("acme-bau", input)).resolves.toEqual({
      message: "You are not allowed to create vacancies for this company.",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns the generic failure for an unknown error, without its text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    singleMock.mockResolvedValue(refusal("connection to server lost: secret detail", "08006"));
    const result = await createJob("acme-bau", input);
    expect(result).toEqual({ message: "We could not complete this request. Try again." });
    expect(JSON.stringify(result)).not.toContain("secret");
    log.mockRestore();
  });
});

describe("reportInvalidJobForm", () => {
  it("records the field names once each, for the organization of the slug", async () => {
    await reportInvalidJobForm("acme-bau", ["title", "salaryMin", "title"]);
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme-bau", "admin", { mfa: false, hideFromOutsiders: true });
    expect(rpcMock).toHaveBeenCalledWith("record_job_form_invalid", { p_org: orgId, p_fields: ["title", "salaryMin"] });
  });

  it.each([[[]], [["not a field"]], [Array.from({ length: 21 }, () => "a")], [["a".repeat(41)]]])(
    "sends nothing for the field list %j",
    async (fields) => {
      await reportInvalidJobForm("acme-bau", fields);
      expect(rpcMock).not.toHaveBeenCalled();
    },
  );

  it("sends nothing for a slug that is not a slug", async () => {
    await reportInvalidJobForm("A B", ["title"]);
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not fail the caller when the report cannot be recorded", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpcMock.mockResolvedValue({ data: null, error: { code: "P0001", message: "CHARA_FORBIDDEN" } });
    await expect(reportInvalidJobForm("acme-bau", ["title"])).resolves.toBeUndefined();
    log.mockRestore();
  });
});

describe("changeJobStatus", () => {
  it("checks the role of the slug, then updates only the status of that organization's live vacancy", async () => {
    await expect(changeJobStatus("acme-bau", jobId, "paused")).resolves.toEqual({});
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme-bau", "admin", { mfa: false, hideFromOutsiders: true });
    expect(updateMock).toHaveBeenCalledWith("jobs", { status: "paused" });
    expect(eqMock).toHaveBeenCalledWith("id", jobId);
    expect(eqMock).toHaveBeenCalledWith("organization_id", orgId);
    expect(isMock).toHaveBeenCalledWith("deleted_at", null);
    expect(revalidatePathMock).toHaveBeenCalledWith(`/en/org/acme-bau/jobs/${jobId}`);
    expect(revalidatePathMock).toHaveBeenCalledWith("/en/org/acme-bau/jobs");
  });

  it.each([["draft"], ["Open"], [""], ["moderation_state"]])("sends nothing for the target status %j", async (to) => {
    await expect(changeJobStatus("acme-bau", jobId, to as "open")).resolves.toEqual({
      message: "We could not complete this request. Try again.",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("sends nothing for a vacancy id that is not an id or a slug that is not a slug", async () => {
    await changeJobStatus("acme-bau", "1; drop table jobs", "open");
    await changeJobStatus("../Acme", jobId, "open");
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("does not update for a caller the role check refused", async () => {
    requireOrgRoleMock.mockRejectedValue(new Error("REDIRECT:/en/forbidden"));
    await expect(changeJobStatus("acme-bau", jobId, "open")).rejects.toThrow("REDIRECT:/en/forbidden");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("tells a caller on a stale page that someone else changed the vacancy, with the status it has now", async () => {
    maybeSingleMock
      .mockResolvedValueOnce(refusal("CHARA_INVALID_TRANSITION", "P0001"))
      .mockResolvedValueOnce({ data: { status: "closed" }, error: null });
    await expect(changeJobStatus("acme-bau", jobId, "paused")).resolves.toEqual({
      message: "This vacancy was changed by someone else, reload. It is now Closed.",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(`/en/org/acme-bau/jobs/${jobId}`);
  });

  it("still says the vacancy was changed when its current status cannot be read", async () => {
    maybeSingleMock
      .mockResolvedValueOnce(refusal("CHARA_INVALID_TRANSITION", "P0001"))
      .mockResolvedValueOnce({ data: null, error: null });
    await expect(changeJobStatus("acme-bau", jobId, "paused")).resolves.toEqual({
      message: "This vacancy was changed by someone else, reload.",
    });
  });

  it("says the caller may not change the status when the guard refuses the role, and nothing else", async () => {
    maybeSingleMock.mockResolvedValue(refusal("CHARA_FORBIDDEN", "42501"));
    await expect(changeJobStatus("acme-bau", jobId, "open")).resolves.toEqual({
      message: "You are not allowed to change the status of this vacancy.",
    });
  });

  it("says the vacancy was not found when row level security or the filters match no row", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    await expect(changeJobStatus("acme-bau", jobId, "open")).resolves.toEqual({ message: "This vacancy could not be found." });
  });

  it("returns the generic failure for an unknown error, without its text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    maybeSingleMock.mockResolvedValue(refusal("connection lost: secret detail", "08006"));
    const result = await changeJobStatus("acme-bau", jobId, "open");
    expect(result).toEqual({ message: "We could not complete this request. Try again." });
    expect(JSON.stringify(result)).not.toContain("secret");
    log.mockRestore();
  });
});
