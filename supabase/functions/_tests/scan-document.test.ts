import assert from "node:assert/strict";
import { detectType, handleScanDocument } from "../scan-document/handler.ts";
import { harness, reply, type Route } from "./harness.ts";

const SECRET = "scheduler-secret";
const USER = "00000000-0000-0000-0000-00000000a001";
const DOCUMENT = "00000000-0000-0000-0000-00000000d001";
const NAME = `${USER}/${DOCUMENT}/My_CV__final_.pdf`;

const SIZE = 1258291;
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00];
const TEXT = [...new TextEncoder().encode("This is not a PDF at all")];

function webhook(record: Record<string, unknown>, overrides: Record<string, unknown> = {}): unknown {
  return { type: "INSERT", schema: "storage", table: "objects", record, ...overrides };
}

const pdfRecord = (name = NAME, mimetype: string | null = "application/pdf") => ({
  id: "00000000-0000-0000-0000-00000000e001",
  bucket_id: "passport-documents",
  name,
  metadata: mimetype === null ? { size: SIZE } : { mimetype, size: SIZE },
});

function request(body: unknown, headers: Record<string, string> = {}, method = "POST"): Request {
  return new Request("http://stack.test/functions/v1/scan-document", {
    method,
    headers: { "x-edge-secret": SECRET, ...headers },
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
}

const SIGN = "POST /storage/v1/object/sign/passport-documents/{id}/{id}/My_CV__final_.pdf";
const READ = "GET /storage/v1/object/sign/passport-documents/{id}/{id}/My_CV__final_.pdf";
const SET_STATUS = "POST /rest/v1/rpc/document_set_scan_status";
const signed = reply(200, { signedURL: `/object/sign/passport-documents/${NAME}?token=t` });
const verdictBody = (
  status: string,
  mime: string | null = "application/pdf",
  size: number | null = SIZE,
  path = NAME,
) => ({
  p_document_id: DOCUMENT,
  p_path: path,
  p_status: status,
  p_mime: mime,
  p_size: size,
});
const statusCalls = (calls: { path: string; body: unknown }[]) =>
  calls.filter((c) => c.path.endsWith("document_set_scan_status")).map((c) => c.body);

function scan(routes: Record<string, Route | Response>, body: unknown) {
  const { calls, client, fetch } = harness({ [SIGN]: signed, ...routes });
  return {
    calls,
    run: () => handleScanDocument(request(body), { client, sharedSecret: SECRET, fetch }),
  };
}

Deno.test("detectType knows the first bytes of a PDF, a JPEG and a PNG and nothing else", () => {
  assert.equal(detectType(Uint8Array.from(PDF)), "application/pdf");
  assert.equal(detectType(Uint8Array.from(JPEG)), "image/jpeg");
  assert.equal(detectType(Uint8Array.from(PNG)), "image/png");
  assert.equal(detectType(Uint8Array.from(TEXT)), null);
  assert.equal(detectType(Uint8Array.from([0x25, 0x50, 0x44, 0x46])), null, "a PDF signature needs its hyphen");
  assert.equal(detectType(Uint8Array.from([0xff, 0xd8])), null, "a truncated JPEG signature");
  assert.equal(detectType(new Uint8Array()), null);
  assert.equal(detectType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), null, "a truncated PNG signature");
});

Deno.test("only POST with the shared secret is served, before anything else is reached", async () => {
  for (
    const [req, status] of [
      [request({}, {}, "GET"), 405],
      [request(webhook(pdfRecord()), { "x-edge-secret": "" }), 401],
      [request(webhook(pdfRecord()), { "x-edge-secret": `${SECRET}x` }), 401],
      [request(webhook(pdfRecord()), { "x-edge-secret": SECRET.slice(0, -1) }), 401],
    ] as const
  ) {
    const { calls, client, fetch } = harness({});
    const response = await handleScanDocument(req, { client, sharedSecret: SECRET, fetch });
    assert.equal(response.status, status);
    assert.equal(calls.length, 0);
  }
  const { calls, client, fetch } = harness({});
  const response = await handleScanDocument(request(webhook(pdfRecord())), { client, sharedSecret: "", fetch });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

Deno.test("a file whose first bytes match its declared type is recorded as skipped (no vendor yet)", async () => {
  for (const [bytes, mimetype] of [[PDF, "application/pdf"], [JPEG, "image/jpeg"], [PNG, "image/png"]] as const) {
    const { calls, run } = scan(
      { [READ]: new Response(Uint8Array.from(bytes), { status: 206 }), [SET_STATUS]: reply(200, "skipped") },
      webhook(pdfRecord(NAME, mimetype)),
    );
    const response = await run();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "skipped" });
    assert.deepEqual(statusCalls(calls), [verdictBody("skipped", mimetype)]);
  }
});

Deno.test("only the first bytes are asked for, with a range request on a 60-second link", async () => {
  const { calls, run } = scan(
    { [READ]: new Response(Uint8Array.from(PDF), { status: 206 }), [SET_STATUS]: reply(200, "skipped") },
    webhook(pdfRecord()),
  );
  await run();
  assert.deepEqual(calls.find((c) => c.path.endsWith("My_CV__final_.pdf") && c.method === "POST")?.body, {
    expiresIn: 60,
  });
  assert.equal(calls.find((c) => c.method === "GET")?.headers.range, "bytes=0-7");
});

Deno.test("a server that ignores the range is read only until the first bytes have arrived", async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(Uint8Array.from(PDF));
    },
    cancel() {
      cancelled = true;
    },
  });
  const { run } = scan(
    { [READ]: () => new Response(body, { status: 200 }), [SET_STATUS]: reply(200, "skipped") },
    webhook(pdfRecord()),
  );
  assert.equal((await run()).status, 200);
  assert.ok(pulls <= 2, `${pulls} chunks were read`);
  assert.ok(cancelled, "the stream was cancelled");
});

Deno.test("text declared as a PDF, an empty object, a type that differs from the bytes and a missing type are rejected", async () => {
  const cases: [string, number[], string | null][] = [
    ["plain text as pdf", TEXT, "application/pdf"],
    ["an empty object", [], "application/pdf"],
    ["a PNG declared as pdf", PNG, "application/pdf"],
    ["a PDF declared as png", PDF, "image/png"],
    ["no declared type", PDF, null],
  ];
  for (const [label, bytes, mimetype] of cases) {
    const { calls, run } = scan(
      { [READ]: new Response(Uint8Array.from(bytes), { status: 206 }), [SET_STATUS]: reply(200, "rejected") },
      webhook(pdfRecord(NAME, mimetype)),
    );
    const response = await run();
    assert.equal(response.status, 200, label);
    assert.deepEqual(statusCalls(calls), [verdictBody("rejected", mimetype)], label);
  }
});

Deno.test("the declared type may carry parameters and any letter case", async () => {
  const name = `${USER.toUpperCase()}/${DOCUMENT.toUpperCase()}/My_CV__final_.pdf`;
  const { calls, run } = scan(
    { [READ]: new Response(Uint8Array.from(PDF), { status: 206 }), [SET_STATUS]: reply(200, "skipped") },
    webhook(pdfRecord(name, "Application/PDF; charset=binary")),
  );
  await run();
  assert.deepEqual(statusCalls(calls), [verdictBody("skipped", "application/pdf", SIZE, name)]);
});

Deno.test("the object name, stored type and stored size go to the database, which compares them with the row", async () => {
  const record = { ...pdfRecord(), metadata: { mimetype: "application/pdf" } };
  const { calls, run } = scan(
    { [READ]: new Response(Uint8Array.from(PDF), { status: 206 }), [SET_STATUS]: reply(200, "rejected") },
    webhook(record),
  );
  assert.deepEqual(await (await run()).json(), { status: "rejected" });
  assert.deepEqual(statusCalls(calls), [verdictBody("skipped", "application/pdf", null)]);
});

Deno.test("a repeated webhook gets the status the row already has", async () => {
  const { run } = scan(
    { [READ]: new Response(Uint8Array.from(PDF), { status: 206 }), [SET_STATUS]: reply(200, "skipped") },
    webhook(pdfRecord()),
  );
  assert.deepEqual(await (await run()).json(), { status: "skipped" });
});

Deno.test("an object that is not a document of the bucket, or not an insert, is ignored or refused without any call", async () => {
  const ignored = [
    webhook({ ...pdfRecord(), bucket_id: "dsar-exports" }),
    webhook(pdfRecord(`${USER}/not-a-uuid/cv.pdf`)),
    webhook(pdfRecord(`${USER}/${DOCUMENT}/folder/cv.pdf`)),
    webhook(pdfRecord(`${USER}/${DOCUMENT}/c v.pdf`)),
  ];
  for (const body of ignored) {
    const { calls, run } = scan({}, body);
    const response = await run();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ignored" });
    assert.equal(calls.length, 0);
  }
  for (
    const body of [
      webhook(pdfRecord(), { type: "DELETE" }),
      webhook(pdfRecord(), { table: "buckets" }),
      { type: "INSERT" },
      [],
      "not json{",
    ]
  ) {
    const { calls, client, fetch } = harness({});
    const response = await handleScanDocument(request(body), { client, sharedSecret: SECRET, fetch });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "bad_request" });
    assert.equal(calls.length, 0);
  }
});

Deno.test("an object that cannot be read leaves the row pending and answers 502", async () => {
  for (const read of [reply(404, { error: "not_found" }), reply(500, { error: "boom" })]) {
    const { calls, run } = scan({ [READ]: read }, webhook(pdfRecord()));
    const response = await run();
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "unavailable" });
    assert.deepEqual(statusCalls(calls), []);
  }
  const { calls, run } = scan({ [SIGN]: reply(500, { message: "down" }) }, webhook(pdfRecord()));
  assert.equal((await run()).status, 502);
  assert.deepEqual(statusCalls(calls), []);
});

Deno.test("a document the database does not know is answered with 200 and not retried", async () => {
  const { run } = scan(
    {
      [READ]: new Response(Uint8Array.from(PDF), { status: 206 }),
      [SET_STATUS]: reply(404, { code: "P0002", message: "CHARA_NOT_FOUND", details: null, hint: null }),
    },
    webhook(pdfRecord()),
  );
  const response = await run();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "unknown_document" });
});

Deno.test("a database failure is a generic 502 that leaks nothing, and is logged with a status and a code only", async () => {
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  let text = "";
  try {
    const { run } = scan(
      {
        [READ]: new Response(Uint8Array.from(PDF), { status: 206 }),
        [SET_STATUS]: reply(500, { code: "XX000", message: `secret internals ${USER}`, details: null, hint: null }),
      },
      webhook(pdfRecord()),
    );
    const response = await run();
    assert.equal(response.status, 502);
    text = await response.text();
  } finally {
    console.error = original;
  }
  assert.deepEqual(JSON.parse(text), { error: "unavailable" });
  assert.ok(!text.includes("secret") && !text.includes(USER));
  assert.deepEqual(logged, [["scan-document failed", { status: undefined, code: "XX000" }]]);
});
