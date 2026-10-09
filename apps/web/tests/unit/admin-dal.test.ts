import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const createClientMock = vi.fn();
const headerValues = vi.hoisted(() => ({ values: {} as Record<string, string> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env.server", () => ({ serverEnv: () => ({ TRUSTED_PROXY_HOPS: 1 }) }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (name: string) => headerValues.values[name] ?? null }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async (extra?: Record<string, string>) => {
    createClientMock(extra);
    return {
      rpc: rpcMock,
    };
  },
}));

const dal = await import("@/lib/dal/admin");

const ID = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";

function userRow(n: number) {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    display_name: n % 2 ? `User ${n}` : null,
    email: `user${n}@example.test`,
    account_kind: "worker",
    status: "active",
    created_at: "2026-10-01T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  headerValues.values = {};
});

describe("the paged searches", () => {
  it("read one row more than a page, show 25 and hand over the cursor of the last row shown", async () => {
    rpcMock.mockResolvedValue({ data: Array.from({ length: 26 }, (_, n) => userRow(n + 1)), error: null });
    const page = await dal.searchUsers("user", null);

    expect(rpcMock).toHaveBeenCalledWith("admin_search_users", { p_term: "user", p_limit: 26, p_after_name: undefined, p_after_id: undefined });
    expect(page.rows).toHaveLength(25);
    expect(page.next).toEqual({ name: "User 25", id: userRow(25).id });
  });

  it("use the empty name of a user without one as the cursor, because that is how the database sorts it", async () => {
    rpcMock.mockResolvedValue({ data: Array.from({ length: 26 }, (_, n) => userRow(2 * (n + 1))), error: null });
    expect((await dal.searchUsers("user", null)).next?.name).toBe("");
  });

  it("have no next page when the page is not full, and pass the cursor of the page asked for", async () => {
    rpcMock.mockResolvedValue({ data: [userRow(1), userRow(3)], error: null });
    const page = await dal.searchUsers("user", { name: "User 25", id: ID });

    expect(page.next).toBeNull();
    expect(rpcMock).toHaveBeenCalledWith("admin_search_users", { p_term: "user", p_limit: 26, p_after_name: "User 25", p_after_id: ID });
    expect(page.rows[0]).toEqual({
      id: userRow(1).id,
      displayName: "User 1",
      email: "user1@example.test",
      accountKind: "worker",
      status: "active",
      createdAt: "2026-10-01T00:00:00Z",
    });
  });

  it("search organisations by the name that sorts them", async () => {
    const row = (n: number) => ({ id: ID, display_name: `Org ${n}`, legal_name: `Org ${n} GmbH`, slug: `org-${n}`, status: "active" });
    rpcMock.mockResolvedValue({ data: Array.from({ length: 26 }, (_, n) => row(n)), error: null });
    expect((await dal.searchOrganizations("org", null)).next).toEqual({ name: "Org 24", id: ID });
  });

  it("send the audit filter as the arguments of the function, leave out what is empty and show the reason, request and job of the row", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          id: 9, actor_id: ID, action: "user.suspend", entity_type: "profile", entity_id: ID, ip: "203.0.113.7",
          metadata: { reason: "Fake profile.", request_id: "7d9c1f0e-5b1a-4c63-9a52-0e6d2b9f4a11", email: "kept@example.test" }, created_at: "2026-10-02T10:00:00Z",
        },
        {
          id: 8, actor_id: null, action: "account_ops.ban_user", entity_type: "profile", entity_id: null, ip: null,
          metadata: { job_id: "41", reason: 7 }, created_at: "2026-10-02T09:00:00Z",
        },
        { id: 7, actor_id: null, action: "job.created", entity_type: "job", entity_id: null, ip: null, metadata: [], created_at: "2026-10-02T08:00:00Z" },
      ],
      error: null,
    });
    const page = await dal.searchAudit({ actor: "", action: "user.suspend", entityType: "", entityId: "", from: "2026-10-01", to: "" }, { at: "2026-10-03T00:00:00Z", id: 20 });

    expect(rpcMock).toHaveBeenCalledWith("admin_search_audit", {
      p_actor: undefined,
      p_action: "user.suspend",
      p_entity_type: undefined,
      p_entity_id: undefined,
      p_from: "2026-10-01",
      p_to: undefined,
      p_limit: 26,
      p_after_at: "2026-10-03T00:00:00Z",
      p_after_id: 20,
    });
    expect(page.rows.map((row) => [row.id, row.reason, row.requestId, row.jobId, row.actorId])).toEqual([
      [9, "Fake profile.", "7d9c1f0e-5b1a-4c63-9a52-0e6d2b9f4a11", null, ID],
      [8, null, null, "41", null],
      [7, null, null, null, null],
    ]);
    expect(Object.keys(page.rows[0]).sort()).toEqual(
      ["action", "actorId", "createdAt", "entityId", "entityType", "id", "jobId", "reason", "requestId"],
    );
  });

  it("fail with a message that names the list and not the database, and keep the cause", async () => {
    const cause = { message: 'relation "profiles" does not exist' };
    rpcMock.mockResolvedValue({ data: null, error: cause });
    const error = await dal.searchUsers("user", null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("The users could not be loaded");
    expect((error as Error).cause).toBe(cause);
  });
});

describe("the request id and the address", () => {
  it("travel with the calls of the console when the proxy gave them, and not otherwise", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    headerValues.values = { "x-request-id": "7d9c1f0e-5b1a-4c63-9a52-0e6d2b9f4a11", "x-forwarded-for": "198.51.100.9" };
    await dal.searchUsers("user", null);
    expect(createClientMock).toHaveBeenLastCalledWith({
      "x-request-id": "7d9c1f0e-5b1a-4c63-9a52-0e6d2b9f4a11",
      "x-forwarded-for": "198.51.100.9",
    });
    headerValues.values = { "x-forwarded-for": "198.51.100.9" };
    await dal.searchUsers("user", null);
    expect(createClientMock).toHaveBeenLastCalledWith({ "x-forwarded-for": "198.51.100.9" });
    headerValues.values = {};
    await dal.searchUsers("user", null);
    expect(createClientMock).toHaveBeenLastCalledWith(undefined);
  });

  it("send the address our proxy wrote, not an entry the client put to its left", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    headerValues.values = { "x-forwarded-for": "10.9.9.9, 198.51.100.9" };
    await dal.searchUsers("user", null);
    expect(createClientMock).toHaveBeenLastCalledWith({ "x-forwarded-for": "198.51.100.9" });
  });

  it("send no address when the entry is not one", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    headerValues.values = { "x-forwarded-for": "not an address" };
    await dal.searchUsers("user", null);
    expect(createClientMock).toHaveBeenLastCalledWith(undefined);
  });
});

describe("the details", () => {
  it("map a user with its memberships and counts", async () => {
    rpcMock.mockResolvedValue({
      data: [{ ...userRow(1), memberships: [{ organization_id: ID, name: "Acme Bau", role: "owner" }], applications_submitted: 3, vacancies_created: 4 }],
      error: null,
    });
    expect(await dal.getUser(userRow(1).id)).toMatchObject({
      memberships: [{ organizationId: ID, name: "Acme Bau", role: "owner" }],
      applicationsSubmitted: 3,
      vacanciesCreated: 4,
    });
  });

  it("answer null for an unknown user or organisation and fail for anything else", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_NOT_FOUND" } });
    expect(await dal.getUser(ID)).toBeNull();
    expect(await dal.getOrganization(ID)).toBeNull();
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(dal.getUser(ID)).rejects.toThrow("The user could not be loaded");
  });

  it("refuse a membership that is not what the database promises", async () => {
    rpcMock.mockResolvedValue({ data: [{ ...userRow(1), memberships: [{ name: "No id" }], applications_submitted: 0, vacancies_created: 0 }], error: null });
    await expect(dal.getUser(userRow(1).id)).rejects.toThrow();
  });

  it("map an organisation with its members and vacancies", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          id: ID,
          display_name: "Acme Bau",
          legal_name: "Acme Bau GmbH",
          slug: "acme-bau",
          status: "suspended",
          members: [{ user_id: ID, display_name: null, role: "owner", accepted_at: "2026-10-01T00:00:00Z" }],
          vacancies: [{ id: ID, title: "Welder", status: "open", moderation_state: "org_suspended" }],
        },
      ],
      error: null,
    });
    expect(await dal.getOrganization(ID)).toMatchObject({
      status: "suspended",
      members: [{ userId: ID, displayName: null, role: "owner" }],
      vacancies: [{ title: "Welder", moderationState: "org_suspended" }],
    });
  });
});

describe("the log of suspensions and the staff", () => {
  it("page the record of suspensions by id", async () => {
    const row = (id: number) => ({
      id,
      target_type: id % 2 ? "organization" : "profile",
      target_id: ID,
      target_name: null,
      action: "account_suspended",
      statement_of_reasons: "Fake profile.",
      actor_id: ID,
      created_at: "2026-10-02T10:00:00Z",
    });
    rpcMock.mockResolvedValue({ data: Array.from({ length: 26 }, (_, n) => row(100 - n)), error: null });
    const page = await dal.listModerationActions(120);

    expect(rpcMock).toHaveBeenCalledWith("admin_list_moderation_actions", { p_limit: 26, p_after_id: 120 });
    expect(page.rows).toHaveLength(25);
    expect(page.next).toBe(76);
    expect(page.rows[0]).toMatchObject({ targetType: "profile", targetName: null, reasons: "Fake profile." });
  });

  it("page the staff by id, one row more than a page, with the status of two-step verification", async () => {
    const row = (id: number) => ({
      id,
      user_id: ID,
      display_name: null,
      email: "a@example.test",
      role: "admin",
      granted_by: null,
      granted_by_email: null,
      granted_at: "2026-10-01T00:00:00Z",
      revoked_at: null,
      mfa_enrolled: true,
      last_sign_in_at: null,
    });
    rpcMock.mockResolvedValue({ data: Array.from({ length: 26 }, (_, n) => row(30 - n)), error: null });
    const page = await dal.listStaff(31);

    expect(rpcMock).toHaveBeenCalledWith("list_platform_staff", { p_limit: 26, p_after_id: 31 });
    expect(page.rows).toHaveLength(25);
    expect(page.next).toBe(6);
    expect(page.rows[0]).toEqual({
      id: 30,
      userId: ID,
      displayName: null,
      email: "a@example.test",
      role: "admin",
      grantedBy: null,
      grantedByEmail: null,
      grantedAt: "2026-10-01T00:00:00Z",
      revokedAt: null,
      mfaEnrolled: true,
      lastSignInAt: null,
    });
    rpcMock.mockResolvedValue({ data: [row(1)], error: null });
    expect((await dal.listStaff(null)).next).toBeNull();
    expect(rpcMock).toHaveBeenLastCalledWith("list_platform_staff", { p_limit: 26, p_after_id: undefined });
  });

  it("list the current version of each legal document as the database gives it", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { slug: "privacy-policy", version: 3, title: "Privacy policy", published_at: "2026-10-03T00:00:00Z" },
        { slug: "worker-terms", version: 0, title: "Worker terms draft", published_at: "2026-01-01T00:00:00Z" },
      ],
      error: null,
    });
    expect(await dal.listLegalDocuments()).toEqual([
      { slug: "privacy-policy", version: 3, title: "Privacy policy", publishedAt: "2026-10-03T00:00:00Z" },
      { slug: "worker-terms", version: 0, title: "Worker terms draft", publishedAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(rpcMock).toHaveBeenCalledWith("admin_list_legal_documents");
  });
});
