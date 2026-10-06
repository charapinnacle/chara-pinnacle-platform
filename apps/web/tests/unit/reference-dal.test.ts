import { beforeEach, describe, expect, it, vi } from "vitest";

const ranges: [number, number][] = [];
let total = 0;
let failFrom: number | null = null;

function from(table: string) {
  const chain = {
    select: () => chain,
    order: () => chain,
    range: (start: number, end: number) => {
      ranges.push([start, end]);
      if (start === failFrom) return Promise.resolve({ data: null, count: null, error: { message: "secret detail" } });
      const rows = Array.from({ length: Math.max(Math.min(end + 1, total) - start, 0) }, (_, index) => ({
        code: String(start + index).padStart(4, "0"),
        name: `${table} ${start + index}`,
      }));
      return Promise.resolve({ data: rows, count: total, error: null });
    },
  };
  return chain;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: <Read>(read: Read) => read }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from }) }));
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54421", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" },
}));

const { getOccupations } = await import("@/lib/dal/reference");

beforeEach(() => {
  ranges.length = 0;
  failFrom = null;
});

describe("reference lists", () => {
  it("read the first page, then every other page together, and return all rows", async () => {
    total = 436;
    const rows = await getOccupations();
    expect(ranges).toEqual([
      [0, 99],
      [100, 199],
      [200, 299],
      [300, 399],
      [400, 499],
    ]);
    expect(rows).toHaveLength(436);
    expect(rows.at(-1)?.code).toBe("0435");
  });

  it("need one request for a short list", async () => {
    total = 40;
    await expect(getOccupations()).resolves.toHaveLength(40);
    expect(ranges).toEqual([[0, 99]]);
  });

  it("fail without the details of the database when a page fails", async () => {
    total = 250;
    failFrom = 200;
    await expect(getOccupations()).rejects.toThrow("The occupations could not be loaded");
  });
});
