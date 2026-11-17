import assert from "node:assert/strict";
import { handleAccountOps } from "../account-ops/handler.ts";
import { crc32, zip } from "../account-ops/zip.ts";
import { type Call, harness, reply, type Route } from "./harness.ts";

// FR-S3 AC7, AC8 (V29): the build_data_export job of account-ops and the zip it writes.

const SECRET = "scheduler-secret";
const USER = "00000000-0000-0000-0000-00000000a001";
const OTHER = "00000000-0000-0000-0000-00000000a002";
const EXPORT = "00000000-0000-0000-0000-00000000e001";
const DOC_A = "00000000-0000-0000-0000-00000000d001";
const DOC_B = "00000000-0000-0000-0000-00000000d002";
const ZIP_PATH = `${USER}/${EXPORT}.zip`;

function request(): Request {
  return new Request("http://stack.test/functions/v1/account-ops", {
    method: "POST",
    headers: { authorization: "Bearer project-jwt", "x-edge-secret": SECRET },
  });
}

function jobs(...rows: { msg_id: number; message: Record<string, unknown> }[]): Route {
  let rest = rows;
  return () => {
    const batch = rest;
    rest = [];
    return reply(200, batch);
  };
}

const build = (msgId: number, over: Record<string, unknown> = {}) => ({
  msg_id: msgId,
  message: { action: "build_data_export", user_id: USER, export_id: EXPORT, ...over },
});

const document = (id: string, file: string) => ({
  title: `Title ${id.slice(-1)}`,
  type: "cv",
  file_name: file,
  file: `documents/${id}/${file}`,
});

function exportData(files: { id: string; file: string; size: number }[], user = USER) {
  return {
    user_id: user,
    sections: {
      account: { user_id: user, email: "amina.okafor@example.test", display_name: "Amina Okafor" },
      passport: { first_name: "Amina", last_name: "Okafor", skills: ["Welding"] },
      documents: files.map((f) => document(f.id, f.file)),
      applications: [{ vacancy: "Welder MIG/MAG", employer: "Acme Construction", status: "applied" }],
    },
    files: files.map((f) => ({
      bucket_id: "passport-documents",
      path: `${user}/${f.id}/${f.file}`,
      name: `documents/${f.id}/${f.file}`,
      size_bytes: f.size,
    })),
  };
}

const PDF = new TextEncoder().encode("%PDF-1.7 the bytes of the candidate's CV");
const acks = (calls: Call[]) => calls.filter((c) => c.path.endsWith("account_ops_ack")).map((c) => c.body);
const steps = (calls: Call[]) => calls.map((c) => `${c.method} ${c.path.split("/").slice(3).join("/")}`);

interface Unzipped {
  name: string;
  method: number;
  flags: number;
  data: Uint8Array;
}

// Reads an archive through its central directory, as an unzip tool does, and checks every entry against its CRC.
async function unzip(archive: Uint8Array): Promise<Unzipped[]> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const end = archive.byteLength - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, "end of central directory");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries: Unzipped[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50, "central directory header");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const plain = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(archive.subarray(at + 46, at + 46 + nameLength));
    assert.equal(view.getUint32(offset, true), 0x04034b50, `local header of ${name}`);
    const localName = view.getUint16(offset + 26, true);
    const start = offset + 30 + localName + view.getUint16(offset + 28, true);
    const body = archive.slice(start, start + size);
    const data = method === 8
      ? new Uint8Array(
        await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer(),
      )
      : body;
    assert.equal(data.length, plain, `size of ${name}`);
    assert.equal(crc32(data), crc, `CRC of ${name}`);
    entries.push({ name, method, flags, data });
    at += 46 + nameLength;
  }
  return entries;
}

function readJson(entries: Unzipped[], name: string): unknown {
  const entry = entries.find((e) => e.name === name);
  assert.ok(entry, name);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(entry.data));
}

Deno.test("crc32 is the checksum of the zip format", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

Deno.test("a zip holds deflated text and stored files with UTF-8 names that read back unchanged", async () => {
  const text = new TextEncoder().encode(JSON.stringify({ name: "Zoë Müller", note: "x".repeat(5000) }));
  const archive = await zip([
    { name: "account.json", data: text, deflate: true },
    { name: "documents/Lebenslauf Zoë.pdf", data: PDF, deflate: false },
    { name: "empty.json", data: new Uint8Array(), deflate: true },
  ], new Date("2026-12-10T08:30:00Z"));
  const entries = await unzip(archive);
  assert.deepEqual(entries.map((e) => [e.name, e.method, e.flags]), [
    ["account.json", 8, 0x0800],
    ["documents/Lebenslauf Zoë.pdf", 0, 0x0800],
    ["empty.json", 8, 0x0800],
  ]);
  assert.deepEqual(entries[0].data, text);
  assert.deepEqual(entries[1].data, PDF);
  assert.ok(archive.length < text.length, "the repetitive text is compressed");
});

Deno.test("AC7, AC8: a build_data_export job writes one zip of JSON files and the user's documents, marks it ready and acknowledges", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs(build(40)),
    "POST /rest/v1/rpc/account_ops_export_data": reply(
      200,
      exportData([
        { id: DOC_A, file: "cv.pdf", size: PDF.length },
        { id: DOC_B, file: "certificate.pdf", size: 41 * 1024 * 1024 },
      ]),
    ),
    "GET /storage/v1/object/passport-documents/{id}/{id}/cv.pdf": () => new Response(PDF, { status: 200 }),
    "POST /storage/v1/object/dsar-exports/{id}/{id}.zip": reply(200, { Key: `dsar-exports/${ZIP_PATH}` }),
    "POST /rest/v1/rpc/account_ops_export_ready": reply(200, true),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 1, failed: 0 });
  assert.deepEqual(steps(calls), [
    "POST rpc/account_ops_dequeue",
    "POST rpc/account_ops_export_data",
    `GET object/passport-documents/${USER}/${DOC_A}/cv.pdf`,
    `POST object/dsar-exports/${ZIP_PATH}`,
    "POST rpc/account_ops_export_ready",
    "POST rpc/account_ops_ack",
    "POST rpc/account_ops_dequeue",
  ]);
  assert.deepEqual(calls[1].body, { p_export: EXPORT });

  const upload = calls[3];
  assert.equal(upload.headers["content-type"], "application/zip");
  assert.equal(upload.headers["x-upsert"], "true");
  assert.ok(upload.raw);
  const entries = await unzip(upload.raw);
  assert.deepEqual(entries.map((e) => e.name), [
    "README.txt",
    "account.json",
    "passport.json",
    "documents.json",
    "applications.json",
    `documents/${DOC_A}/cv.pdf`,
  ]);
  assert.deepEqual(readJson(entries, "account.json"), {
    user_id: USER,
    email: "amina.okafor@example.test",
    display_name: "Amina Okafor",
  });
  assert.deepEqual(readJson(entries, "applications.json"), [
    { vacancy: "Welder MIG/MAG", employer: "Acme Construction", status: "applied" },
  ]);
  assert.deepEqual(readJson(entries, "documents.json"), [
    document(DOC_A, "cv.pdf"),
    {
      ...document(DOC_B, "certificate.pdf"),
      file: null,
      note: "Not included in this copy because of its size. Download it from your passport.",
    },
  ]);
  assert.deepEqual(entries[5].data, PDF);
  const readme = new TextDecoder().decode(entries[0].data);
  assert.ok(readme.includes("account.json, passport.json, documents.json, applications.json"), readme);
  assert.ok(readme.includes("1 document was not included; documents.json says why."), readme);
  assert.ok(!new TextDecoder().decode(upload.raw).includes("passport-documents"), "no storage path is written");

  assert.deepEqual(calls[4].body, { p_export: EXPORT, p_size: upload.raw.length, p_files_left_out: 1 });
  assert.deepEqual(acks(calls), [{
    p_msg_id: 40,
    p_result: { export_built: 1, files_included: 1, files_left_out: 1, size_bytes: upload.raw.length },
  }]);
});

Deno.test("a job read again after the export was built, or after the account was erased, builds nothing", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs(build(41)),
    "POST /rest/v1/rpc/account_ops_export_data": reply(200, null),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 1, failed: 0 });
  assert.equal(calls.filter((c) => c.path.startsWith("/storage/")).length, 0);
  assert.deepEqual(acks(calls), [{ p_msg_id: 41, p_result: { export_built: 0 } }]);
});

Deno.test("a request that stopped being queued while the file was written loses the file again", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs(build(42)),
    "POST /rest/v1/rpc/account_ops_export_data": reply(200, exportData([])),
    "POST /storage/v1/object/dsar-exports/{id}/{id}.zip": reply(200, { Key: `dsar-exports/${ZIP_PATH}` }),
    "POST /rest/v1/rpc/account_ops_export_ready": reply(200, false),
    "DELETE /storage/v1/object/dsar-exports": reply(200, [{ name: ZIP_PATH }]),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 1, failed: 0 });
  assert.deepEqual(calls.filter((c) => c.method === "DELETE").map((c) => c.body), [{ prefixes: [ZIP_PATH] }]);
  assert.deepEqual(acks(calls), [{ p_msg_id: 42, p_result: { export_built: 0 } }]);
});

Deno.test("a document deleted meanwhile is listed without its file", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs(build(43)),
    "POST /rest/v1/rpc/account_ops_export_data": reply(200, exportData([{ id: DOC_A, file: "cv.pdf", size: 10 }])),
    "GET /storage/v1/object/passport-documents/{id}/{id}/cv.pdf": reply(400, {
      statusCode: "404",
      error: "not_found",
      message: "Object not found",
    }),
    "POST /storage/v1/object/dsar-exports/{id}/{id}.zip": reply(200, { Key: `dsar-exports/${ZIP_PATH}` }),
    "POST /rest/v1/rpc/account_ops_export_ready": reply(200, true),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  await handleAccountOps(request(), { client, sharedSecret: SECRET });
  const upload = calls.find((c) => c.path.startsWith("/storage/v1/object/dsar-exports"));
  assert.ok(upload?.raw);
  const entries = await unzip(upload.raw);
  assert.equal(entries.filter((e) => e.name.startsWith("documents/")).length, 0);
  assert.deepEqual(readJson(entries, "documents.json"), [{
    ...document(DOC_A, "cv.pdf"),
    file: null,
    note: "Not included because the file was deleted while the copy was prepared.",
  }]);
  assert.deepEqual(acks(calls), [{
    p_msg_id: 43,
    p_result: { export_built: 1, files_included: 0, files_left_out: 1, size_bytes: upload.raw.length },
  }]);
});

Deno.test("a document the database lists without a file (not checked yet) is counted as not included", async () => {
  const data = {
    ...exportData([]),
    sections: {
      ...exportData([]).sections,
      documents: [{
        ...document(DOC_A, "cv.pdf"),
        file: null,
        note: "Not included because the file has not passed its check.",
      }],
    },
  };
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs(build(46)),
    "POST /rest/v1/rpc/account_ops_export_data": reply(200, data),
    "POST /storage/v1/object/dsar-exports/{id}/{id}.zip": reply(200, { Key: `dsar-exports/${ZIP_PATH}` }),
    "POST /rest/v1/rpc/account_ops_export_ready": reply(200, true),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.equal(calls.filter((c) => c.path.startsWith("/storage/v1/object/passport-documents")).length, 0);
  const ready = calls.find((c) => c.path.endsWith("account_ops_export_ready"));
  assert.equal((ready?.body as { p_files_left_out: number }).p_files_left_out, 1);
});

Deno.test("a file name with two dots inside it is exported", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs(build(47)),
    "POST /rest/v1/rpc/account_ops_export_data": reply(
      200,
      exportData([{ id: DOC_A, file: "cv..final.pdf", size: PDF.length }]),
    ),
    "GET /storage/v1/object/passport-documents/{id}/{id}/cv..final.pdf": () => new Response(PDF, { status: 200 }),
    "POST /storage/v1/object/dsar-exports/{id}/{id}.zip": reply(200, { Key: `dsar-exports/${ZIP_PATH}` }),
    "POST /rest/v1/rpc/account_ops_export_ready": reply(200, true),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 1, failed: 0 });
  const upload = calls.find((c) => c.path.startsWith("/storage/v1/object/dsar-exports"));
  assert.ok(upload?.raw);
  const entries = await unzip(upload.raw);
  assert.deepEqual(entries.find((e) => e.name === `documents/${DOC_A}/cv..final.pdf`)?.data, PDF);
});

Deno.test("data of another user, a file outside the user's folder or bucket, and a malformed job are never written", async () => {
  const cases: [string, unknown, Record<string, unknown>][] = [
    ["another user", exportData([], OTHER), {}],
    ["outside the folder", {
      ...exportData([]),
      files: [{
        bucket_id: "passport-documents",
        path: `${OTHER}/${DOC_A}/cv.pdf`,
        name: "documents/x",
        size_bytes: 1,
      }],
    }, {}],
    ["a path whose last segment is ..", {
      ...exportData([]),
      files: [{
        bucket_id: "passport-documents",
        path: `${USER}/${DOC_A}/..`,
        name: `documents/${DOC_A}/cv.pdf`,
        size_bytes: 1,
      }],
    }, {}],
    ["a name whose last segment is ..", {
      ...exportData([]),
      files: [{
        bucket_id: "passport-documents",
        path: `${USER}/${DOC_A}/cv.pdf`,
        name: `documents/${DOC_A}/..`,
        size_bytes: 1,
      }],
    }, {}],
    ["a path one folder too deep", {
      ...exportData([]),
      files: [{
        bucket_id: "passport-documents",
        path: `${USER}/${DOC_A}/x/cv.pdf`,
        name: `documents/${DOC_A}/cv.pdf`,
        size_bytes: 1,
      }],
    }, {}],
    ["a name outside the documents folder", {
      ...exportData([]),
      files: [{
        bucket_id: "passport-documents",
        path: `${USER}/${DOC_A}/cv.pdf`,
        name: "account.json",
        size_bytes: 1,
      }],
    }, {}],
    ["another bucket", {
      ...exportData([]),
      files: [{ bucket_id: "partner-documents", path: `${USER}/${DOC_A}/cv.pdf`, name: "documents/x", size_bytes: 1 }],
    }, {}],
    ["no export id", exportData([]), { export_id: undefined }],
    ["an export id that is not a uuid", exportData([]), { export_id: "../x" }],
  ];
  for (const [label, data, over] of cases) {
    const { calls, client } = harness({
      "POST /rest/v1/rpc/account_ops_dequeue": jobs(build(44, over)),
      "POST /rest/v1/rpc/account_ops_export_data": reply(200, data),
    });
    const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
    assert.deepEqual(await response.json(), { processed: 0, failed: 1 }, label);
    assert.equal(calls.filter((c) => c.path.startsWith("/storage/")).length, 0, label);
    assert.deepEqual(acks(calls), [], label);
  }
});

Deno.test("a failed upload leaves the request queued and the job unacknowledged, to be read again", async () => {
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs(build(45)),
    "POST /rest/v1/rpc/account_ops_export_data": reply(200, exportData([])),
    "POST /storage/v1/object/dsar-exports/{id}/{id}.zip": reply(500, {
      statusCode: "500",
      error: "Internal",
      message: "boom",
    }),
  });
  const response = await handleAccountOps(request(), { client, sharedSecret: SECRET });
  assert.deepEqual(await response.json(), { processed: 0, failed: 1 });
  assert.equal(calls.filter((c) => c.path.endsWith("account_ops_export_ready")).length, 0);
  assert.deepEqual(acks(calls), []);
});

Deno.test("AC7: the submissions of the job order network are written as submissions.json in UTF-8", async () => {
  const submissions = [{
    side: "candidate",
    job_order: "Schweißer für Lübeck",
    partner: "Alpha Recruitment",
    status: "submitted",
    shared_documents: ["Zertifikat"],
    requested_at: "2027-03-02T10:00:00Z",
  }];
  const data = { ...exportData([]), sections: { ...exportData([]).sections, submissions } };
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs(build(49)),
    "POST /rest/v1/rpc/account_ops_export_data": reply(200, data),
    "POST /storage/v1/object/dsar-exports/{id}/{id}.zip": reply(200, { Key: `dsar-exports/${ZIP_PATH}` }),
    "POST /rest/v1/rpc/account_ops_export_ready": reply(200, true),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  await handleAccountOps(request(), { client, sharedSecret: SECRET });
  const upload = calls.find((c) => c.path.startsWith("/storage/v1/object/dsar-exports"));
  assert.ok(upload?.raw);
  const entries = await unzip(upload.raw);
  assert.deepEqual(readJson(entries, "submissions.json"), submissions);
  assert.ok(new TextDecoder().decode(entries[0].data).includes("submissions.json"));
});

Deno.test("AC7: conversations, the messages the user sent and contact requests are written as JSON files in UTF-8", async () => {
  const conversations = [{
    conversation_id: "00000000-0000-0000-0000-0000000c0001",
    side: "candidate",
    context: "contact_request",
    with: "Beta Bau GmbH",
    opened_at: "2027-03-02T10:00:00Z",
  }];
  const messages = [{
    conversation_id: conversations[0].conversation_id,
    text: "Grüße aus Lagos, ich kann im Juni anfangen.",
    sent_at: "2027-03-02T11:00:00Z",
  }];
  const contact_requests = [{
    side: "worker",
    organization: "Beta Bau GmbH",
    message: "Schweißer gesucht.",
    status: "accepted",
  }];
  const base = exportData([]);
  const data = { ...base, sections: { ...base.sections, conversations, messages, contact_requests } };
  const { calls, client } = harness({
    "POST /rest/v1/rpc/account_ops_dequeue": jobs(build(50)),
    "POST /rest/v1/rpc/account_ops_export_data": reply(200, data),
    "POST /storage/v1/object/dsar-exports/{id}/{id}.zip": reply(200, { Key: `dsar-exports/${ZIP_PATH}` }),
    "POST /rest/v1/rpc/account_ops_export_ready": reply(200, true),
    "POST /rest/v1/rpc/account_ops_ack": reply(200, true),
  });
  await handleAccountOps(request(), { client, sharedSecret: SECRET });
  const upload = calls.find((c) => c.path.startsWith("/storage/v1/object/dsar-exports"));
  assert.ok(upload?.raw);
  const entries = await unzip(upload.raw);
  assert.deepEqual(readJson(entries, "conversations.json"), conversations);
  assert.deepEqual(readJson(entries, "messages.json"), messages);
  assert.deepEqual(readJson(entries, "contact_requests.json"), contact_requests);
  const readme = new TextDecoder().decode(entries[0].data);
  for (const file of ["conversations.json", "messages.json", "contact_requests.json"]) assert.ok(readme.includes(file));
});
