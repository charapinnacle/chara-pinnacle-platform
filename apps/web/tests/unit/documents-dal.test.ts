import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Step = [string, ...unknown[]];
let steps: Step[] = [];
let outcome: { data: unknown; error: unknown } = { data: [], error: null };

function from(table: string) {
  steps = [["from", table]];
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "not", "neq", "lte", "eq", "in", "order", "limit", "or"]) {
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

const { getDocumentReminders, hasUsableCv } = await import("@/lib/dal/documents");
const { fetchDocuments } = await import("@/lib/documents/fetch-documents");

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

describe("hasUsableCv", () => {
  it("asks for one CV whose scan status lets it be used and answers true when there is one", async () => {
    outcome = { data: [{ id: "doc-1" }], error: null };
    expect(await hasUsableCv()).toBe(true);
    expect(steps).toEqual([
      ["from", "worker_documents"],
      ["select", "id"],
      ["eq", "type", "cv"],
      ["in", "scan_status", ["skipped", "clean"]],
      ["limit", 1],
    ]);
  });

  it("answers false when the candidate has no usable CV", async () => {
    outcome = { data: [], error: null };
    expect(await hasUsableCv()).toBe(false);
  });

  it("throws without leaking the cause into the message when the read fails", async () => {
    outcome = { data: null, error: { message: "secret" } };
    await expect(hasUsableCv()).rejects.toThrow("The documents could not be loaded");
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
      checking: false,
    });
    expect(steps).toEqual([
      ["from", "worker_documents"],
      ["select", "id, title, type, size_bytes, created_at, expires_on, scan_status"],
      ["order", "created_at", { ascending: false }],
      ["order", "id", { ascending: false }],
      ["limit", 26],
    ]);
  });

  it("says another page exists and does not return the extra row", async () => {
    outcome = {
      data: Array.from({ length: 26 }, (_, i) => row(`d${i}`, "2026-10-01T10:00:00+00:00")),
      error: null,
    };
    const page = await fetchDocuments(null);
    expect(page.hasMore).toBe(true);
    expect(page.items).toHaveLength(25);
  });

  it("continues after the last row on the index order, created_at then id", async () => {
    outcome = { data: [], error: null };
    await fetchDocuments({ createdAt: "2026-10-01T10:00:00+00:00", id: "x" });
    expect(steps.at(-1)).toEqual([
      "or",
      "created_at.lt.2026-10-01T10:00:00+00:00,and(created_at.eq.2026-10-01T10:00:00+00:00,id.lt.x)",
    ]);
  });

  it("asks for the rows already shown on a reload, within what the API returns", async () => {
    outcome = { data: [], error: null };
    await fetchDocuments(null, 60);
    expect(steps.at(-1)).toEqual(["limit", 61]);
    await fetchDocuments(null, 400);
    expect(steps.at(-1)).toEqual(["limit", 100]);
    await fetchDocuments(null, 3);
    expect(steps.at(-1)).toEqual(["limit", 26]);
  });

  it("marks a pending row of the last minutes as being checked and an old one as not finished", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
    outcome = {
      data: [
        { ...row("new", "2026-10-03T11:58:00+00:00"), scan_status: "pending" },
        { ...row("old", "2026-10-03T11:50:00+00:00"), scan_status: "pending" },
        { ...row("done", "2026-10-03T11:59:00+00:00"), scan_status: "skipped" },
      ],
      error: null,
    };
    const page = await fetchDocuments(null);
    expect(page.items.map((item) => [item.id, item.checking])).toEqual([
      ["new", true],
      ["old", false],
      ["done", false],
    ]);
  });

  it("rejects when the read fails, so the screen can show its retry state", async () => {
    outcome = { data: null, error: { message: "network" } };
    await expect(fetchDocuments(null)).rejects.toThrow("The documents could not be loaded");
  });
});
