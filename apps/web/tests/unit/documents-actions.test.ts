import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateMock = vi.hoisted(() => vi.fn());
const requireUserMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.fn();
const signUploadMock = vi.fn();
const signMock = vi.fn();

type Call = { table: string; operation: string; values?: unknown; filters: Record<string, unknown> };
const calls: Call[] = [];
const order: string[] = [];
let outcome: { data: unknown; error: unknown } = { data: [], error: null };

function from(table: string) {
  const call: Call = { table, operation: "select", filters: {} };
  const chain = {
    insert: (values: unknown) => {
      Object.assign(call, { operation: "insert", values });
      order.push("insert");
      calls.push(call);
      return Promise.resolve(outcome);
    },
    update: (values: unknown) => Object.assign(call, { operation: "update", values }) && chain,
    select: () => chain,
    eq: (column: string, value: unknown) => Object.assign(call.filters, { [column]: value }) && chain,
    maybeSingle: () => {
      calls.push(call);
      return Promise.resolve(outcome);
    },
    then: (resolve: (value: unknown) => unknown) => {
      calls.push(call);
      return Promise.resolve(outcome).then(resolve);
    },
  };
  return chain;
}

const storage = { from: (bucket: string) => ({ createSignedUploadUrl: (path: string) => signUploadMock(bucket, path), createSignedUrl: (...args: unknown[]) => signMock(bucket, ...args) }) };

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("@/lib/dal/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock, from, storage }) }));

const actions = await import("@/lib/actions/documents");

const userId = "6f1c2d52-8a64-4d0e-a1c4-6b0b1d7b4d11";
const documentId = "0a1b2c3d-0000-4000-8000-000000000001";
const GENERIC = "We could not complete this request. Try again.";
const file = { name: "My CV (final).pdf", size: 1_258_291, type: "application/pdf" };
const input = { type: "cv", title: "  Amina Okafor CV 2026 ", expiresOn: "", file };

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  order.length = 0;
  outcome = { data: [{ id: documentId }], error: null };
  requireUserMock.mockResolvedValue({ id: userId });
  rpcMock.mockResolvedValue({ data: null, error: null });
  signUploadMock.mockImplementation(async () => {
    order.push("sign");
    return { data: { path: "p", token: "t", signedUrl: "u" }, error: null };
  });
  signMock.mockResolvedValue({ data: { signedUrl: "https://storage.test/object?token=x" }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("startDocumentUpload", () => {
  it("inserts the metadata row first, with the sanitised name and the path that carries the id, then signs that path", async () => {
    const result = await actions.startDocumentUpload(input);

    expect(requireUserMock).toHaveBeenCalledWith("en");
    expect(calls).toHaveLength(1);
    const values = calls[0].values as Record<string, unknown>;
    expect(calls[0]).toMatchObject({ table: "worker_documents", operation: "insert" });
    expect(values).toMatchObject({
      worker_user_id: userId,
      type: "cv",
      title: "Amina Okafor CV 2026",
      file_name: "My_CV__final_.pdf",
      mime: "application/pdf",
      size_bytes: 1_258_291,
      expires_on: null,
    });
    expect(values.storage_path).toBe(`${userId}/${values.id}/My_CV__final_.pdf`);
    expect(Object.keys(values)).not.toContain("scan_status");
    expect(signUploadMock).toHaveBeenCalledWith("passport-documents", values.storage_path);
    expect(order).toEqual(["insert", "sign"]);
    expect(result).toEqual({ upload: { documentId: values.id, path: "p", token: "t" } });
    expect(revalidateMock).toHaveBeenCalledWith("/en/dashboard/worker");
  });

  it("sends an expiry date for a certificate only", async () => {
    await actions.startDocumentUpload({ ...input, type: "certificate", expiresOn: "2027-05-01" });
    await actions.startDocumentUpload({ ...input, type: "cv", expiresOn: "2027-05-01" });
    expect(calls.map((call) => (call.values as { expires_on: unknown }).expires_on)).toEqual(["2027-05-01", null]);
  });

  it("refuses an invalid upload before anything is written", async () => {
    const result = await actions.startDocumentUpload({ type: "passport", title: "", expiresOn: "", file: { ...file, type: "image/gif" } });
    expect(Object.keys(result.errors ?? {}).sort()).toEqual(["file", "title", "type"]);
    expect(calls).toEqual([]);
    expect(signUploadMock).not.toHaveBeenCalled();
  });

  it.each([[0], [15_728_641]])("refuses a file of %i bytes", async (size) => {
    const result = await actions.startDocumentUpload({ ...input, file: { ...file, size } });
    expect(result.errors).toHaveProperty("file");
    expect(calls).toEqual([]);
  });

  it("does not trust the browser: an extension that does not match the type is refused", async () => {
    const result = await actions.startDocumentUpload({ ...input, file: { name: "a.exe", size: 10, type: "application/pdf" } });
    expect(result.errors).toEqual({ file: "Choose a PDF, JPG or PNG file." });
    expect(calls).toEqual([]);
  });

  it("shows a refused expiry date beside its field without a number", async () => {
    outcome = { data: null, error: { message: "CHARA_INVALID_INPUT", code: "P0001", details: "expires_on" } };
    const result = await actions.startDocumentUpload({ ...input, type: "certificate", expiresOn: "2090-01-01" });
    expect(result).toEqual({ errors: { expiresOn: "Choose a date that is not too far ahead." } });
    expect(signUploadMock).not.toHaveBeenCalled();
  });

  it("answers generically, and logs only a code and message, when the database refuses", async () => {
    outcome = { data: null, error: { message: "new row violates row-level security policy", code: "42501", details: "secret" } };
    expect(await actions.startDocumentUpload(input)).toEqual({ message: GENERIC });
    expect(signUploadMock).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("Document action failed", { code: "42501", message: "new row violates row-level security policy" });
  });

  it("answers generically when the upload link cannot be made, leaving the pending row to be deleted", async () => {
    signUploadMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await actions.startDocumentUpload(input)).toEqual({ message: GENERIC });
    expect(calls).toHaveLength(1);
  });
});

describe("renameDocument", () => {
  it("updates only the title of the own document", async () => {
    expect(await actions.renameDocument(documentId, { title: " CV English " })).toEqual({});
    expect(calls[0]).toMatchObject({
      table: "worker_documents",
      operation: "update",
      values: { title: "CV English" },
      filters: { id: documentId, worker_user_id: userId },
    });
    expect(revalidateMock).toHaveBeenCalledWith("/en/dashboard/worker");
  });

  it("refuses an empty and an overlong title beside the field and an id that is not one", async () => {
    expect((await actions.renameDocument(documentId, { title: "" })).errors).toHaveProperty("title");
    expect((await actions.renameDocument(documentId, { title: "x".repeat(121) })).errors).toHaveProperty("title");
    expect(await actions.renameDocument("not-an-id", { title: "ok" })).toEqual({ message: GENERIC });
    expect(calls).toEqual([]);
  });

  it("says so when the document is not the caller's or is gone", async () => {
    outcome = { data: [], error: null };
    expect(await actions.renameDocument(documentId, { title: "ok" })).toEqual({ message: "This document no longer exists." });
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});

describe("deleteDocument", () => {
  it("calls the database function and treats a document that is already gone as done", async () => {
    expect(await actions.deleteDocument(documentId)).toEqual({});
    expect(rpcMock).toHaveBeenCalledWith("delete_worker_document", { p_document_id: documentId });
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_NOT_FOUND", code: "P0002", details: null } });
    expect(await actions.deleteDocument(documentId)).toEqual({});
  });

  it("reports any other refusal generically", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "CHARA_FORBIDDEN", code: "P0001", details: "x" } });
    expect(await actions.deleteDocument(documentId)).toEqual({ message: GENERIC });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("does not call the database for an id that is not one", async () => {
    expect(await actions.deleteDocument("../x")).toEqual({ message: GENERIC });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("getDocumentDownload", () => {
  const row = { storage_path: `${userId}/${documentId}/My_CV__final_.pdf`, file_name: "My_CV__final_.pdf", scan_status: "skipped" };

  it("signs the path for 60 seconds as a download under the stored file name", async () => {
    outcome = { data: row, error: null };
    expect(await actions.getDocumentDownload(documentId)).toEqual({ url: "https://storage.test/object?token=x" });
    expect(calls[0].filters).toEqual({ id: documentId });
    expect(signMock).toHaveBeenCalledWith("passport-documents", row.storage_path, 60, { download: "My_CV__final_.pdf" });
  });

  it.each(["pending", "rejected"])("offers no link for a %s file", async (scanStatus) => {
    outcome = { data: { ...row, scan_status: scanStatus }, error: null };
    expect(await actions.getDocumentDownload(documentId)).toEqual({ message: "This file cannot be downloaded." });
    expect(signMock).not.toHaveBeenCalled();
  });

  it("offers a link for a file a scanning vendor passed", async () => {
    outcome = { data: { ...row, scan_status: "clean" }, error: null };
    expect(await actions.getDocumentDownload(documentId)).toHaveProperty("url");
  });

  it("finds no row for a document of someone else or a deleted one", async () => {
    outcome = { data: null, error: null };
    expect(await actions.getDocumentDownload(documentId)).toEqual({ message: "This document no longer exists." });
    expect(signMock).not.toHaveBeenCalled();
  });

  it("answers generically when the link cannot be made", async () => {
    outcome = { data: row, error: null };
    signMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await actions.getDocumentDownload(documentId)).toEqual({ message: GENERIC });
  });
});
