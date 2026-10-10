import { beforeEach, describe, expect, it, vi } from "vitest";

type Step = [string, ...unknown[]];
let steps: Step[] = [];
let outcome: { data: unknown; error: unknown } = { data: [], error: null };

function from(table: string) {
  steps = [["from", table]];
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "order", "limit", "or"]) {
    chain[name] = (...args: unknown[]) => {
      steps.push([name, ...args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(outcome).then(resolve);
  return chain;
}

vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({ from }) }));

const { fetchAccessLog } = await import("@/lib/access-log/fetch-access-log");
const { formatDateTime } = await import("@/lib/i18n/format");

const row = (id: number, at: string) => ({
  id,
  organization_name: "Acme Bau",
  document_title: "Amina Okafor CV 2026",
  accessed_at: at,
});

beforeEach(() => {
  outcome = { data: [], error: null };
});

describe("fetchAccessLog", () => {
  it("reads the view newest first with one extra row to know whether another page exists", async () => {
    outcome = { data: [row(2, "2026-10-02T10:00:00+00:00"), row(1, "2026-10-01T10:00:00+00:00")], error: null };
    const page = await fetchAccessLog(null);
    expect(page.hasMore).toBe(false);
    expect(page.items[0]).toEqual({
      id: 2,
      organizationName: "Acme Bau",
      documentTitle: "Amina Okafor CV 2026",
      accessedAt: "2026-10-02T10:00:00+00:00",
    });
    expect(steps).toEqual([
      ["from", "v_my_document_access_log"],
      ["select", "id, organization_name, document_title, accessed_at"],
      ["order", "accessed_at", { ascending: false }],
      ["order", "id", { ascending: false }],
      ["limit", 26],
    ]);
  });

  it("returns 25 rows and says another page exists when 26 come back", async () => {
    outcome = { data: Array.from({ length: 26 }, (_, i) => row(100 - i, "2026-10-01T10:00:00+00:00")), error: null };
    const page = await fetchAccessLog(null);
    expect(page.hasMore).toBe(true);
    expect(page.items).toHaveLength(25);
    expect(page.items.at(-1)?.id).toBe(76);
  });

  it("continues after the last row on the index order, accessed_at then id", async () => {
    await fetchAccessLog({ accessedAt: "2026-10-01T10:00:00+00:00", id: 7 });
    expect(steps.at(-1)).toEqual([
      "or",
      "accessed_at.lt.2026-10-01T10:00:00+00:00,and(accessed_at.eq.2026-10-01T10:00:00+00:00,id.lt.7)",
    ]);
  });

  it("keeps a missing title (a deleted document) as null", async () => {
    outcome = { data: [{ ...row(1, "2026-10-01T10:00:00+00:00"), document_title: null }], error: null };
    expect((await fetchAccessLog(null)).items[0].documentTitle).toBeNull();
  });

  it("rejects when the read fails, so the screen can show its retry state", async () => {
    outcome = { data: null, error: { message: "network" } };
    await expect(fetchAccessLog(null)).rejects.toThrow("The access log could not be loaded");
  });
});

describe("formatDateTime", () => {
  it("states the time zone, always UTC", () => {
    expect(formatDateTime("2026-10-05T14:03:09+00:00")).toBe("5 October 2026 at 14:03 UTC");
    expect(formatDateTime("2026-10-05T23:30:00+02:00")).toBe("5 October 2026 at 21:30 UTC");
  });
});
