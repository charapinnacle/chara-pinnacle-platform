import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { code: string; message: string } | null };

let result: Result = { data: null, error: null };
const from = vi.hoisted(() => vi.fn());
const select = vi.hoisted(() => vi.fn());
const inSlugs = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));

const { listCurrentLegalDocuments } = await import("@/lib/dal/legal");

beforeEach(() => {
  from.mockReturnValue({ select });
  select.mockReturnValue({ in: inSlugs });
  inSlugs.mockReturnValue({ limit: () => Promise.resolve(result) });
});

describe("listCurrentLegalDocuments (FR-H3 AC1)", () => {
  it("reads the current view for the given slugs and returns the version, the date and the draft flag by slug", async () => {
    result = {
      data: [
        { slug: "privacy-policy", version: 3, published_at: "2026-09-01T00:00:00Z", is_draft: false },
        { slug: "cookie-policy", version: 1, published_at: "2026-08-01T00:00:00Z", is_draft: true },
      ],
      error: null,
    };
    const current = await listCurrentLegalDocuments(["privacy-policy", "cookie-policy", "worker-terms"]);
    expect(from).toHaveBeenCalledWith("v_legal_current");
    expect(inSlugs).toHaveBeenCalledWith("slug", ["privacy-policy", "cookie-policy", "worker-terms"]);
    expect(current.get("privacy-policy")).toEqual({ version: 3, publishedAt: "2026-09-01T00:00:00Z", isDraft: false });
    expect(current.get("cookie-policy")).toEqual({ version: 1, publishedAt: "2026-08-01T00:00:00Z", isDraft: true });
    expect(current.has("worker-terms")).toBe(false);
  });

  it("returns an empty map when no slug has a published version", async () => {
    result = { data: [], error: null };
    expect((await listCurrentLegalDocuments(["privacy-policy"])).size).toBe(0);
  });

  it("throws when the read fails, without the database message in the error", async () => {
    result = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    await expect(listCurrentLegalDocuments(["privacy-policy"])).rejects.toThrow("The legal documents could not be listed");
  });

  it("throws when a row does not have the expected shape", async () => {
    result = { data: [{ slug: "privacy-policy", version: "3" }], error: null };
    await expect(listCurrentLegalDocuments(["privacy-policy"])).rejects.toThrow();
  });
});
