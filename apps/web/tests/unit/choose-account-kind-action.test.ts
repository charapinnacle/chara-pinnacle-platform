import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LegalDocumentSummary } from "@/lib/validation/consents";

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
);
const rpcMock = vi.fn();
const documentsMock = vi.hoisted(() => vi.fn());
const refreshShellMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/app/refresh-shell", () => ({ refreshAppShell: refreshShellMock }));
vi.mock("@/lib/dal/legal", () => ({
  getSignupDocuments: documentsMock,
  getPendingReconsents: vi.fn(),
}));
vi.mock("@/lib/dal/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock }) }));

const { chooseAccountKind } = await import("@/lib/actions/consents");

const documents: LegalDocumentSummary[] = ["terms-of-service", "employer-terms"].map((slug) => ({
  slug,
  title: `Title of ${slug}`,
  version: 3,
  publishedAt: "2026-10-01T00:00:00Z",
  changeSummary: "Changed.",
}));
const entries = documents.map(({ slug, version }) => ({ purpose: slug, version }));

beforeEach(() => {
  vi.clearAllMocks();
  documentsMock.mockResolvedValue(documents);
  rpcMock.mockResolvedValue({ data: "company", error: null });
});

describe("chooseAccountKind", () => {
  it("commits the chosen kind with the accepted versions and goes back to onboarding", async () => {
    await expect(chooseAccountKind("company", entries)).rejects.toThrow("REDIRECT:/en/onboarding");
    expect(refreshShellMock).toHaveBeenCalledOnce();
    expect(documentsMock).toHaveBeenCalledWith("company");
    expect(rpcMock).toHaveBeenCalledWith("choose_account_kind", { p_kind: "company", p_consents: entries });
  });

  it.each(["admin", "", "Worker", "company "])("refuses the kind %j without calling the database", async (kind) => {
    await expect(chooseAccountKind(kind, entries)).resolves.toEqual({
      error: "We could not save this step. Try again.",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("names the document that was not accepted and calls nothing", async () => {
    await expect(chooseAccountKind("company", entries.slice(0, 1))).resolves.toEqual({
      error: "Accept the Title of employer-terms to continue",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("refuses an accepted version that is not the current one", async () => {
    const stale = entries.map((entry) => ({ ...entry, version: 2 }));
    await expect(chooseAccountKind("company", stale)).resolves.toEqual({
      error: "Accept the Title of terms-of-service to continue",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("asks for a reload when the database says a document changed in the meantime", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_CONSENT_REQUIRED" } });
    await expect(chooseAccountKind("company", entries)).resolves.toEqual({
      error: "A legal document has changed. Reload the page to see the current version.",
    });
  });

  it("shows a generic message for any other database error and never its text", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FORBIDDEN" } });
    const result = await chooseAccountKind("company", entries);
    expect(result).toEqual({ error: "We could not save this step. Try again." });
  });
});
