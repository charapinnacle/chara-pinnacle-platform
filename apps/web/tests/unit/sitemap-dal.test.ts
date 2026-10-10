import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { code: string; message: string } | null };

const calls: { name: string; args: Record<string, unknown> }[] = [];
const selects: { table: string; column: string; filter: [string, unknown[]]; limit: number }[] = [];
let results: Result[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve(results.shift() ?? { data: [], error: null });
    },
    from: (table: string) => ({
      select: (column: string) => ({
        in: (name: string, values: unknown[]) => ({
          limit: (limit: number) => {
            selects.push({ table, column, filter: [name, values], limit });
            return Promise.resolve(results.shift() ?? { data: [], error: null });
          },
        }),
      }),
    }),
  }),
}));

const { listPublishedLegalSlugs, listSitemapVacancies } = await import("@/lib/dal/sitemap");

const entry = (n: number) => ({
  id: `0a1b2c3d-0000-4000-8000-${String(n).padStart(12, "0")}`,
  created_at: `2026-03-${String(30 - n).padStart(2, "0")}T10:00:00.123456+00:00`,
  updated_at: `2026-04-${String(n).padStart(2, "0")}T10:00:00+00:00`,
});
const page = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => entry(from + index));

beforeEach(() => {
  calls.length = 0;
  selects.length = 0;
  results = [];
});

describe("listSitemapVacancies (FR-H5 AC3, AC4)", () => {
  it("asks for the first page without a cursor and returns the id and the date of the last change", async () => {
    results = [{ data: page(1, 3), error: null }];
    expect(await listSitemapVacancies(100)).toEqual([
      { id: entry(1).id, updatedAt: entry(1).updated_at },
      { id: entry(2).id, updatedAt: entry(2).updated_at },
      { id: entry(3).id, updatedAt: entry(3).updated_at },
    ]);
    expect(calls[0]).toEqual({ name: "list_sitemap_jobs", args: { p_after_created: undefined, p_after_id: undefined, p_limit: 100 } });
  });

  it("reads page after page from the cursor of the last entry until an empty page, whatever size the function cuts them at", async () => {
    results = [
      { data: page(1, 5000), error: null },
      { data: page(5001, 7000), error: null },
      { data: [], error: null },
    ];
    const vacancies = await listSitemapVacancies(49_000);
    expect(vacancies).toHaveLength(7000);
    expect(calls.map((call) => call.args.p_limit)).toEqual([49_000, 44_000, 42_000]);
    expect(calls[1].args).toEqual({ p_after_created: entry(5000).created_at, p_after_id: entry(5000).id, p_limit: 44_000 });
  });

  it("stops at the limit, asking for no more than is left", async () => {
    results = [
      { data: page(1, 5000), error: null },
      { data: page(5001, 6000), error: null },
    ];
    expect(await listSitemapVacancies(6000)).toHaveLength(6000);
    expect(calls.map((call) => call.args.p_limit)).toEqual([6000, 1000]);
  });

  it("returns an empty list when no vacancy is public and asks once", async () => {
    results = [{ data: [], error: null }];
    expect(await listSitemapVacancies(100)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("throws when the read fails, so that the sitemap answers with an error and not with a short list", async () => {
    results = [{ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }];
    await expect(listSitemapVacancies(100)).rejects.toThrow("The vacancies of the sitemap could not be loaded");
  });

  it("throws when the answer is not the list it should be", async () => {
    results = [{ data: [{ id: 5 }], error: null }];
    await expect(listSitemapVacancies(100)).rejects.toThrow();
  });
});

describe("listPublishedLegalSlugs", () => {
  it("asks for the given slugs and returns those that have a published version, once each and in the given order", async () => {
    results = [{ data: [{ slug: "privacy-policy" }, { slug: "privacy-policy" }, { slug: "cookie-policy" }], error: null }];
    expect(await listPublishedLegalSlugs(["cookie-policy", "nope", "privacy-policy"])).toEqual(["cookie-policy", "privacy-policy"]);
    expect(selects).toEqual([
      { table: "legal_documents", column: "slug", filter: ["slug", ["cookie-policy", "nope", "privacy-policy"]], limit: 100 },
    ]);
  });

  it("throws when the read fails", async () => {
    results = [{ data: null, error: { code: "42501", message: "permission denied" } }];
    await expect(listPublishedLegalSlugs(["privacy-policy"])).rejects.toThrow("The legal pages of the sitemap could not be loaded");
  });
});
