import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Step = [string, ...unknown[]];
let steps: Step[] = [];
let outcome: { data: unknown; error: unknown } = { data: [], error: null };

function from(table: string) {
  steps = [["from", table]];
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "not", "neq", "lte", "order", "limit", "or"]) {
    chain[name] = (...args: unknown[]) => {
      steps.push([name, ...args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(outcome).then(resolve);
  return chain;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({ from }) }));

const { getDocumentReminders } = await import("@/lib/dal/documents");
const { DOCUMENT_PAGE_SIZE, fetchDocuments } = await import("@/lib/documents/fetch-documents");

afterEach(() => vi.useRealTimers());

describe("getDocumentReminders", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T23:59:00Z"));
    outcome = { data: [{ id: "a", title: "Welding certificate", expires_on: "2026-10-23" }], error: null };
  });

  it("reads expired and soon-expiring documents of usable files, soonest first, within a bound", async () => {
    expect(await getDocumentReminders()).toEqual([{ id: "a", title: "Welding certificate", expiresOn: "2026-10-23" }]);
    expect(steps).toEqual([
      ["from", "worker_documents"],
      ["select", "id, title, expires_on"],
      ["not", "expires_on", "is", null],
      ["neq", "scan_status", "rejected"],
      ["lte", "expires_on", "2026-11-02"],
      ["order", "expires_on"],
      ["limit", 100],
    ]);
  });

  it("throws without leaking the cause into the message when the read fails", async () => {
    outcome = { data: null, error: { message: "secret" } };
    await expect(getDocumentReminders()).rejects.toThrow("The document reminders could not be loaded");
  });
});

describe("fetchDocuments", () => {
  const row = (id: string, at: string) => ({
    id,
    title: `T ${id}`,
    type: "cv",
    size_bytes: 10,
    created_at: at,
    expires_on: null,
    scan_status: "skipped",
  });

  it("reads the newest page with one extra row to know whether another exists", async () => {
    outcome = { data: [row("b", "2026-10-02T10:00:00+00:00"), row("a", "2026-10-01T10:00:00+00:00")], error: null };
    const page = await fetchDocuments(null);
    expect(page.hasMore).toBe(false);
    expect(page.items.map((item) => item.id)).toEqual(["b", "a"]);
    expect(page.items[0]).toEqual({
      id: "b",
      title: "T b",
      type: "cv",
      sizeBytes: 10,
      createdAt: "2026-10-02T10:00:00+00:00",
      expiresOn: null,
      scanStatus: "skipped",
    });
    expect(steps).toEqual([
      ["from", "worker_documents"],
      ["select", "id, title, type, size_bytes, created_at, expires_on, scan_status"],
      ["order", "created_at", { ascending: false }],
      ["order", "id", { ascending: false }],
      ["limit", DOCUMENT_PAGE_SIZE + 1],
    ]);
  });

  it("says another page exists and does not return the extra row", async () => {
    outcome = {
      data: Array.from({ length: DOCUMENT_PAGE_SIZE + 1 }, (_, i) => row(`d${i}`, "2026-10-01T10:00:00+00:00")),
      error: null,
    };
    const page = await fetchDocuments(null);
    expect(page.hasMore).toBe(true);
    expect(page.items).toHaveLength(DOCUMENT_PAGE_SIZE);
  });

  it("continues after the last row on the index order, created_at then id", async () => {
    outcome = { data: [], error: null };
    await fetchDocuments({ createdAt: "2026-10-01T10:00:00+00:00", id: "x" });
    expect(steps.at(-1)).toEqual([
      "or",
      "created_at.lt.2026-10-01T10:00:00+00:00,and(created_at.eq.2026-10-01T10:00:00+00:00,id.lt.x)",
    ]);
  });

  it("rejects when the read fails, so the screen can show its retry state", async () => {
    outcome = { data: null, error: { message: "network" } };
    await expect(fetchDocuments(null)).rejects.toThrow("The documents could not be loaded");
  });
});
