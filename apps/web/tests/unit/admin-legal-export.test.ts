import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const requireRoleMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/admin", () => ({
  adminClient: async () => ({ rpc: rpcMock }),
  failure: (what: string, cause: unknown) => new Error(`${what} could not be loaded`, { cause }),
}));
vi.mock("@/lib/dal/session", () => ({ requirePlatformRole: requireRoleMock }));

const { exportLegalDocuments } = await import("@/lib/dal/admin-legal");
const { GET } = await import("@/app/[lang]/(admin)/admin/legal/export/route");

const entry = (n: number) => ({
  slug: `doc-${String(n).padStart(3, "0")}`,
  version: 1,
  title: `Document ${n}`,
  body: `Body ${n}`,
  change_summary: "Initial version",
  is_draft: false,
  published_at: "2026-10-01T00:00:00Z",
});
const rows = (from: number, count: number) => Array.from({ length: count }, (_, i) => entry(from + i));

function call() {
  return GET(new Request("http://localhost/en/admin/legal/export"), { params: Promise.resolve({ lang: "en" }) } as Parameters<typeof GET>[1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireRoleMock.mockResolvedValue({ user: { id: "admin-1" }, roles: ["admin"] });
});

describe("the export of the legal documents", () => {
  it("reads the pages by keyset until a short page", async () => {
    rpcMock.mockResolvedValueOnce({ data: rows(0, 25), error: null }).mockResolvedValueOnce({ data: rows(25, 3), error: null });
    const pages: unknown[][] = [];
    for await (const page of await exportLegalDocuments()) pages.push(page);
    expect(pages.map((page) => page.length)).toEqual([25, 3]);
    expect(rpcMock).toHaveBeenNthCalledWith(1, "admin_export_legal_documents", { p_after_slug: undefined, p_after_version: undefined, p_limit: 25 });
    expect(rpcMock).toHaveBeenNthCalledWith(2, "admin_export_legal_documents", { p_after_slug: "doc-024", p_after_version: 1, p_limit: 25 });
  });

  it("stops at an empty page after a full one", async () => {
    rpcMock.mockResolvedValueOnce({ data: rows(0, 25), error: null }).mockResolvedValueOnce({ data: [], error: null });
    const pages: unknown[][] = [];
    for await (const page of await exportLegalDocuments()) pages.push(page);
    expect(pages).toHaveLength(1);
  });

  it("does not hide a failed read", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    await expect((await exportLegalDocuments()).next()).rejects.toThrow("could not be loaded");
  });

  it("answers one JSON array with every entry as a download, for an administrator only", async () => {
    rpcMock.mockResolvedValueOnce({ data: rows(0, 25), error: null }).mockResolvedValueOnce({ data: rows(25, 5), error: null });
    const response = await call();
    expect(requireRoleMock).toHaveBeenCalledWith("en", ["admin"]);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="legal-documents-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const parsed = JSON.parse(await response.text()) as Record<string, unknown>[];
    expect(parsed).toHaveLength(30);
    expect(Object.keys(parsed[0]).sort()).toEqual(["body", "change_summary", "is_draft", "published_at", "slug", "title", "version"]);
    expect(parsed[29].slug).toBe("doc-029");
  });

  it("answers an empty array when no version is published", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    expect(JSON.parse(await (await call()).text())).toEqual([]);
  });

  it("fails before the response when the first page cannot be read, so no cut file is sent", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } });
    await expect(call()).rejects.toThrow("could not be loaded");
  });

  it("reads nothing when the guard refuses", async () => {
    requireRoleMock.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
