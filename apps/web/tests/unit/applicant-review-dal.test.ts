import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };

let rpcResult: Result = { data: null, error: null };
let tableResult: Result = { data: null, error: null };
let session: { access_token: string } | null = { access_token: "token-of-the-member" };
const calls: unknown[][] = [];
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421" } }));
vi.mock("@/lib/env.server", () => ({ serverEnv: () => ({ DOCUMENT_URL_ENDPOINT: process.env.TEST_ENDPOINT }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (name: string, args: unknown) => {
      calls.push(["rpc", name, args]);
      return Promise.resolve(rpcResult);
    },
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({
          maybeSingle: () => {
            calls.push(["select", table, columns, column, value]);
            return Promise.resolve(tableResult);
          },
        }),
      }),
      insert: (row: unknown) => {
        calls.push(["insert", table, row]);
        return Promise.resolve(tableResult);
      },
    }),
    auth: { getSession: async () => ({ data: { session } }) },
  }),
}));

const {
  addApplicationNote,
  getApplicantProfile,
  isProfileChanged,
  listApplicationNotes,
  listSharedDocuments,
  requestDocumentLink,
} = await import("@/lib/dal/applicant-review");

const id = "0a1b2c3d-0000-4000-8000-000000000001";
const documentId = "0a1b2c3d-0000-4000-8000-0000000000d1";
const failure = (message: string, code = "P0001", details: string | null = null) => ({ code, message, details });

beforeEach(() => {
  calls.length = 0;
  rpcResult = { data: null, error: null };
  tableResult = { data: null, error: null };
  session = { access_token: "token-of-the-member" };
  delete process.env.TEST_ENDPOINT;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getApplicantProfile", () => {
  it("reads the snapshot and the cover note of the one application", async () => {
    tableResult = { data: { profile_snapshot: { headline: "Welder", skills: ["TIG"] }, cover_note: "Hello" }, error: null };
    const profile = await getApplicantProfile(id);
    expect(profile).toMatchObject({ coverNote: "Hello", snapshot: { headline: "Welder", skills: ["TIG"] } });
    expect(calls).toEqual([["select", "job_applications", "profile_snapshot, cover_note", "id", id]]);
  });

  it("answers null for an application the policy hides, and throws without database text on an error", async () => {
    tableResult = { data: null, error: null };
    expect(await getApplicantProfile(id)).toBeNull();
    tableResult = { data: null, error: failure("secret internals") };
    await expect(getApplicantProfile(id)).rejects.toThrow("The profile could not be loaded");
  });
});

describe("listSharedDocuments", () => {
  it("maps the rows and sends the id only", async () => {
    rpcResult = {
      data: [{ id: documentId, title: "CV", type: "cv", file_name: "cv.pdf", size_bytes: 2048, expires_on: null, available: true }],
      error: null,
    };
    expect(await listSharedDocuments(id)).toEqual([
      { id: documentId, title: "CV", type: "cv", fileName: "cv.pdf", sizeBytes: 2048, expiresOn: null, available: true },
    ]);
    expect(calls).toEqual([["rpc", "application_documents", { p_application_id: id }]]);
  });

  it("throws without database text on an error", async () => {
    rpcResult = { data: null, error: failure("secret internals") };
    await expect(listSharedDocuments(id)).rejects.toThrow("The documents could not be loaded");
  });
});

describe("isProfileChanged", () => {
  it.each([true, false, null])("passes on %s", async (value) => {
    rpcResult = { data: value, error: null };
    expect(await isProfileChanged(id)).toBe(value);
  });

  it("throws on an error", async () => {
    rpcResult = { data: null, error: failure("CHARA_NOT_FOUND", "P0002") };
    await expect(isProfileChanged(id)).rejects.toThrow("The profile check could not be loaded");
  });
});

describe("listApplicationNotes", () => {
  it("maps the rows", async () => {
    rpcResult = { data: [{ id: 3, author_name: "Mia", body: "Call", created_at: "2026-10-04T09:00:00Z", has_more: false }], error: null };
    expect(await listApplicationNotes(id)).toEqual({
      notes: [{ id: 3, authorName: "Mia", body: "Call", createdAt: "2026-10-04T09:00:00Z" }],
      hasMore: false,
    });
    expect(calls).toEqual([["rpc", "list_application_notes", { p_application_id: id, p_before_id: undefined }]]);
  });

  it("passes the cursor on and reports that older notes exist", async () => {
    rpcResult = { data: [{ id: 3, author_name: null, body: "Call", created_at: "2026-10-04T09:00:00Z", has_more: true }], error: null };
    expect((await listApplicationNotes(id, 40)).hasMore).toBe(true);
    expect(calls).toEqual([["rpc", "list_application_notes", { p_application_id: id, p_before_id: 40 }]]);
  });

  it("has no older notes and no notes for an empty page", async () => {
    rpcResult = { data: [], error: null };
    expect(await listApplicationNotes(id)).toEqual({ notes: [], hasMore: false });
  });
});

describe("addApplicationNote", () => {
  it("inserts the note with the application and the organization, and no author", async () => {
    expect(await addApplicationNote(id, "org-1", "Call on Monday")).toBeNull();
    expect(calls).toEqual([["insert", "application_notes", { application_id: id, organization_id: "org-1", body: "Call on Monday" }]]);
  });

  it.each([
    [failure("CHARA_FEATURE_NOT_IN_PLAN", "P0001", "read_only_free_plan"), "read_only_free_plan"],
    [failure("CHARA_FORBIDDEN", "P0001", "organization_suspended"), "organization_suspended"],
    [failure("insert or update violates foreign key", "23503"), "not_found"],
    [failure("new row violates row-level security policy", "42501"), "not_found"],
    [failure("violates check constraint", "23514"), "invalid"],
    [failure("something else", "XX000"), "failed"],
  ])("maps the refusal %j to %s", async (error, expected) => {
    tableResult = { data: null, error };
    expect(await addApplicationNote(id, "org-1", "x")).toBe(expected);
  });
});

describe("requestDocumentLink", () => {
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it("forwards the session token of the member and the purpose, and returns the link", async () => {
    fetchMock.mockResolvedValue(answer(200, { url: "http://127.0.0.1:54421/storage/v1/object/sign/x?token=t" }));
    expect(await requestDocumentLink(documentId)).toEqual({ url: "http://127.0.0.1:54421/storage/v1/object/sign/x?token=t" });
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe("http://127.0.0.1:54421/functions/v1/document-url");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer token-of-the-member");
    expect(JSON.parse(init.body)).toEqual({ documentId, purpose: "application_review" });
  });

  it("uses the address of the deployment when one is set", async () => {
    process.env.TEST_ENDPOINT = "http://127.0.0.1:54432/";
    fetchMock.mockResolvedValue(answer(200, { url: "http://127.0.0.1:54421/x" }));
    await requestDocumentLink(documentId);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:54432/");
  });

  it.each([
    [403, { error: "forbidden" }, "unavailable"],
    [404, { error: "not_found" }, "unavailable"],
    [409, { error: "not_scanned" }, "not_scanned"],
    [429, { error: "rate_limited" }, "rate_limited"],
    [401, { error: "unauthorized" }, "failed"],
    [502, { error: "unavailable" }, "failed"],
    [200, { nothing: true }, "failed"],
    [200, { url: "not a url" }, "failed"],
    [200, { url: "javascript:alert(1)" }, "failed"],
    [200, { url: "data:text/html,x" }, "failed"],
  ])("maps the answer %s %j to the refusal %s and gives no link", async (status, body, refusal) => {
    fetchMock.mockResolvedValue(answer(status, body));
    expect(await requestDocumentLink(documentId)).toEqual({ refusal });
  });

  it("is a failure when the function cannot be reached, when its answer is not JSON, and when there is no session", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    expect(await requestDocumentLink(documentId)).toEqual({ refusal: "failed" });
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    expect(await requestDocumentLink(documentId)).toEqual({ refusal: "failed" });
    session = null;
    fetchMock.mockClear();
    expect(await requestDocumentLink(documentId)).toEqual({ refusal: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
