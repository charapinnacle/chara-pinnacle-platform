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
const releasedMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/app/refresh-shell", () => ({ refreshAppShell: refreshShellMock }));
vi.mock("@/lib/dal/legal", () => ({
  getSignupDocuments: documentsMock,
  getPendingReconsents: vi.fn(),
}));
vi.mock("@/lib/dal/release", () => ({ isReleased: releasedMock }));
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
  releasedMock.mockResolvedValue(true);
});

describe("chooseAccountKind", () => {
  it("commits the chosen kind with the accepted versions and goes back to onboarding", async () => {
    await expect(chooseAccountKind("company", entries)).rejects.toThrow("REDIRECT:/en/onboarding");
    expect(refreshShellMock).toHaveBeenCalledOnce();
    expect(documentsMock).toHaveBeenCalledWith("company", undefined);
    expect(rpcMock).toHaveBeenCalledWith("choose_account_kind", { p_kind: "company", p_consents: entries });
    expect(rpcMock.mock.calls[0][1]).not.toHaveProperty("p_org_type", expect.anything());
  });

  it.each(["recruitment_company", "staffing_company"] as const)(
    "FR-J1: commits a company account of the partner type %s with the documents of that type",
    async (type) => {
      await expect(chooseAccountKind(type, entries)).rejects.toThrow("REDIRECT:/en/onboarding");
      expect(releasedMock).toHaveBeenCalledWith("release_partner_directories");
      expect(documentsMock).toHaveBeenCalledWith("company", type);
      expect(rpcMock).toHaveBeenCalledWith("choose_account_kind", {
        p_kind: "company",
        p_consents: entries,
        p_org_type: type,
      });
    },
  );

  it("FR-J1: refuses a partner type while release 2a is off, without reading the documents or calling the database", async () => {
    releasedMock.mockResolvedValue(false);
    await expect(chooseAccountKind("staffing_company", entries)).resolves.toEqual({
      error: "We could not save this step. Try again.",
    });
    expect(documentsMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each(["admin", "", "Worker", "company ", "employer", "agency"])("refuses the kind %j without calling the database", async (kind) => {
    await expect(chooseAccountKind(kind, entries)).resolves.toEqual({
      error: "We could not save this step. Try again.",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("names the document that was not accepted and calls nothing", async () => {
    await expect(chooseAccountKind("company", entries.slice(0, 1))).resolves.toEqual({
      error: "Accept the Title of employer-terms to continue.",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("refuses an accepted version that is not the current one", async () => {
    const stale = entries.map((entry) => ({ ...entry, version: 2 }));
    await expect(chooseAccountKind("company", stale)).resolves.toEqual({
      error: "Accept the Title of terms-of-service to continue.",
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
