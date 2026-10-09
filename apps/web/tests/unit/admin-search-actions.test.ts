import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const searchUsersMock = vi.fn();
const searchOrganizationsMock = vi.fn();
const searchAuditMock = vi.fn();
const searchJobsMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/session", () => ({ requirePlatformRole: requireRoleMock }));
vi.mock("@/lib/dal/admin", () => ({
  searchUsers: searchUsersMock,
  searchOrganizations: searchOrganizationsMock,
  searchAudit: searchAuditMock,
}));
vi.mock("@/lib/dal/admin-jobs", () => ({ searchJobs: searchJobsMock }));

const actions = await import("@/lib/actions/admin-search");

const ID = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const filter = { actor: "", action: "user.suspend", entityType: "", entityId: "", from: "", to: "" };

beforeEach(() => {
  vi.clearAllMocks();
  requireRoleMock.mockResolvedValue({ user: { id: "staff" }, roles: ["admin"] });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("the vacancy search action", () => {
  it("asks for the Trust & Safety role alone and answers a page with the rows of the data access layer", async () => {
    searchJobsMock.mockResolvedValue({ rows: [{ id: ID }], next: { at: "2026-10-01T10:00:00+00:00", id: ID } });
    const answer = await actions.searchJobsAction("  welder ", { at: "2026-10-02T10:00:00+00:00", id: ID });

    expect(requireRoleMock).toHaveBeenCalledWith("en", ["trust_safety"]);
    expect(searchJobsMock).toHaveBeenCalledWith("welder", { at: "2026-10-02T10:00:00+00:00", id: ID });
    expect(answer).toEqual({ ok: true, page: { rows: [{ id: ID }], next: { at: "2026-10-01T10:00:00+00:00", id: ID } } });
  });

  it("refuses a term and a cursor that are not what the page hands out, without reading", async () => {
    expect(await actions.searchJobsAction("ab", null)).toEqual({ ok: false });
    expect(await actions.searchJobsAction("welder", { at: "yesterday", id: ID })).toEqual({ ok: false });
    expect(await actions.searchJobsAction("welder", { at: "2026-10-02T10:00:00+00:00", id: "1" })).toEqual({ ok: false });
    expect(searchJobsMock).not.toHaveBeenCalled();
  });

  it("answers a failure of the database as not ok and logs only the code of the cause", async () => {
    searchJobsMock.mockRejectedValue(new Error("The vacancies could not be loaded", { cause: { message: "the term was welder", code: "57014" } }));
    expect(await actions.searchJobsAction("welder", null)).toEqual({ ok: false });
    expect(console.error).toHaveBeenCalledWith("The vacancy search failed", { code: "57014" });
  });

  it("lets the refusal of the role guard through", async () => {
    requireRoleMock.mockRejectedValue(new Error("NOT_FOUND"));
    await expect(actions.searchJobsAction("welder", null)).rejects.toThrow("NOT_FOUND");
    expect(searchJobsMock).not.toHaveBeenCalled();
  });
});

describe("the search actions", () => {
  it("ask for the role of the page before reading anything", async () => {
    searchUsersMock.mockResolvedValue({ rows: [], next: null });
    searchOrganizationsMock.mockResolvedValue({ rows: [], next: null });
    searchAuditMock.mockResolvedValue({ rows: [], next: null });
    await actions.searchUsersAction("abc", null);
    await actions.searchOrganizationsAction("abc", null);
    await actions.searchAuditAction(filter, null);

    expect(requireRoleMock.mock.calls).toEqual([["en", ["admin", "trust_safety"]], ["en", ["admin", "trust_safety"]], ["en", ["admin"]]]);
  });

  it("answer a page with the rows of the data access layer", async () => {
    searchUsersMock.mockResolvedValue({ rows: [{ id: ID }], next: { name: "A", id: ID } });
    expect(await actions.searchUsersAction("  abc ", { name: "", id: ID })).toEqual({ ok: true, page: { rows: [{ id: ID }], next: { name: "A", id: ID } } });
    expect(searchUsersMock).toHaveBeenCalledWith("abc", { name: "", id: ID });
  });

  it.each([["ab"], ["x".repeat(101)], [""]])("refuse the term %j without reading", async (term) => {
    expect(await actions.searchUsersAction(term, null)).toEqual({ ok: false });
    expect(await actions.searchOrganizationsAction(term, null)).toEqual({ ok: false });
    expect(searchUsersMock).not.toHaveBeenCalled();
    expect(searchOrganizationsMock).not.toHaveBeenCalled();
  });

  it("refuse a cursor and a filter that are not what the pages hand out", async () => {
    expect(await actions.searchUsersAction("abc", { name: "A", id: "not-a-uuid" })).toEqual({ ok: false });
    expect(await actions.searchAuditAction({ ...filter, actor: "bob" }, null)).toEqual({ ok: false });
    expect(await actions.searchAuditAction(filter, { at: "yesterday", id: 1 })).toEqual({ ok: false });
    expect(searchUsersMock).not.toHaveBeenCalled();
    expect(searchAuditMock).not.toHaveBeenCalled();
  });

  it("answer a failure of the database as not ok, log only the code of the cause and send nothing of it", async () => {
    const cause = { message: "secret internals", details: "the term was ada", code: "57014" };
    searchAuditMock.mockRejectedValue(new Error("The audit log could not be loaded", { cause }));
    const answer = await actions.searchAuditAction(filter, null);

    expect(answer).toEqual({ ok: false });
    expect(JSON.stringify(answer)).not.toContain("secret");
    expect(console.error).toHaveBeenCalledWith("The audit search failed", { code: "57014" });
  });

  it("let the refusal of the role guard through", async () => {
    requireRoleMock.mockRejectedValue(new Error("NOT_FOUND"));
    await expect(actions.searchOrganizationsAction("abc", null)).rejects.toThrow("NOT_FOUND");
  });
});
