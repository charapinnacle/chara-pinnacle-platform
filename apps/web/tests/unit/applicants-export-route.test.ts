import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgRoleMock = vi.hoisted(() => vi.fn());
const getJobMock = vi.hoisted(() => vi.fn());
const exportMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/session", () => ({ requireOrgRole: requireOrgRoleMock }));
vi.mock("@/lib/dal/hiring", () => ({ getJob: getJobMock }));
vi.mock("@/lib/dal/applicant-list", () => ({ exportApplicants: exportMock }));

const { POST } = await import("@/app/[lang]/(app)/org/[slug]/applicants/export/route");

const job = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const organization = { id: "org-1", slug: "acme-bau", displayName: "Acme Bau", role: "member", suspended: false };

function call(fields: Record<string, string>, slug = "acme-bau") {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return POST(new Request("http://localhost/en/org/acme-bau/applicants/export", { method: "POST", body }), {
    params: Promise.resolve({ lang: "en", slug }),
  } as Parameters<typeof POST>[1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgRoleMock.mockResolvedValue({ user: { id: "user-1" }, organization });
  getJobMock.mockResolvedValue({ id: job });
  exportMock.mockResolvedValue({
    rows: [{ candidateName: "=HYPERLINK('http://x')", status: "shortlisted", appliedAt: "2026-09-04T10:00:00+00:00", completeness: 80, documents: 2 }],
  });
});

describe("the CSV export route", () => {
  it("answers a CSV download of the filter with a quoted formula and no other cache or type", async () => {
    const response = await call({ job, stage: "shortlisted" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="applicants-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe(
      "Candidate,Stage,Applied,Completeness (%),Documents\r\n'=HYPERLINK('http://x'),Shortlisted,2026-09-04,80,2\r\n",
    );
    expect(exportMock).toHaveBeenCalledWith(job, "shortlisted");
    expect(requireOrgRoleMock).toHaveBeenCalledWith("en", "acme-bau", "member", { hideFromOutsiders: true });
    expect(getJobMock).toHaveBeenCalledWith("org-1", job);
  });

  it("exports every stage for an empty filter", async () => {
    await call({ job, stage: "" });
    expect(exportMock).toHaveBeenCalledWith(job, null);
  });

  it.each([
    [{ job: "not-a-uuid", stage: "" }],
    [{ job, stage: "hacked" }],
    [{ stage: "" }],
  ])("refuses %j as not found before looking anything up", async (fields) => {
    expect((await call(fields)).status).toBe(404);
    expect(requireOrgRoleMock).not.toHaveBeenCalled();
    expect(exportMock).not.toHaveBeenCalled();
  });

  it("refuses a request that is no form as not found", async () => {
    const response = await POST(new Request("http://localhost/x", { method: "POST", body: "job=1", headers: { "content-type": "text/plain" } }), {
      params: Promise.resolve({ lang: "en", slug: "acme-bau" }),
    } as Parameters<typeof POST>[1]);
    expect(response.status).toBe(404);
    expect(exportMock).not.toHaveBeenCalled();
  });

  it("refuses an address that is not a slug", async () => {
    expect((await call({ job, stage: "" }, "Not A Slug!")).status).toBe(404);
    expect(exportMock).not.toHaveBeenCalled();
  });

  it("answers a vacancy of another organization, and any vacancy of a suspended one, as not found without exporting", async () => {
    getJobMock.mockResolvedValue(null);
    expect((await call({ job, stage: "" })).status).toBe(404);
    getJobMock.mockResolvedValue({ id: job });
    requireOrgRoleMock.mockResolvedValue({ user: { id: "user-1" }, organization: { ...organization, suspended: true } });
    expect((await call({ job, stage: "" })).status).toBe(404);
    expect(exportMock).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404],
    ["not_in_plan", 403],
    ["too_many_rows", 413],
  ])("answers the refusal %s with status %i and a sentence, no file", async (refusal, status) => {
    exportMock.mockResolvedValue({ refusal });
    const response = await call({ job, stage: "" });
    expect(response.status).toBe(status);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(await response.text()).not.toContain("Candidate,Stage");
  });
});
