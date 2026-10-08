import assert from "node:assert/strict";
import { ArchiveError, s3Archive, signature } from "../audit-export/archive.ts";
import { handleAuditExport, previousMonth } from "../audit-export/handler.ts";
import { type Call, harness, reply } from "./harness.ts";

const SECRET = "scheduler-secret";
const encoder = new TextEncoder();

function request(body = "{}", headers: Record<string, string> = {}, method = "POST"): Request {
  return new Request("http://stack.test/functions/v1/audit-export", {
    method,
    headers: { authorization: "Bearer project-jwt", "x-edge-secret": SECRET, ...headers },
    body: method === "POST" ? body : undefined,
  });
}

interface Put {
  key: string;
  body: string;
  contentType: string;
}

function archiveStub(outcomes: (boolean | Error)[] = []) {
  const puts: Put[] = [];
  return {
    puts,
    archive: {
      put(key: string, body: Uint8Array<ArrayBuffer>, contentType: string) {
        puts.push({ key, body: new TextDecoder().decode(body), contentType });
        const outcome = outcomes[puts.length - 1] ?? true;
        return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
      },
    },
  };
}

function setup(routes: Parameters<typeof harness>[0], outcomes: (boolean | Error)[] = []) {
  const stub = archiveStub(outcomes);
  const alerts: [string, Record<string, unknown>][] = [];
  const { calls, client } = harness(routes);
  const deps = {
    client,
    sharedSecret: SECRET,
    archive: stub.archive,
    now: () => new Date("2026-03-01T03:00:00Z"),
    alert: (alert: string, detail: Record<string, unknown>) => alerts.push([alert, detail]),
  };
  return { calls, deps, alerts, puts: stub.puts };
}

const row = (id: number) => ({
  id,
  actor_id: null,
  action: "user.suspend",
  entity_type: "profile",
  entity_id: `e-${id}`,
  metadata: { reason: "r" },
  ip: null,
  created_at: `2026-02-10T12:00:00.${String(id).padStart(6, "0")}+00:00`,
});
const rpcNames = (calls: Call[]) => calls.map((c) => c.path.split("/").pop());
const sha256Hex = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)))].map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");

Deno.test("the month is the one before the day of the call, in UTC", () => {
  assert.equal(previousMonth(new Date("2026-03-01T03:00:00Z")), "2026-02");
  assert.equal(previousMonth(new Date("2026-01-01T00:00:00Z")), "2025-12");
  assert.equal(previousMonth(new Date("2026-03-31T23:59:59Z")), "2026-02");
  assert.equal(previousMonth(new Date("2024-03-01T03:00:00Z")), "2024-02");
});

Deno.test("only POST is served and a request without the secret is refused before the database is reached", async () => {
  const { calls, deps } = setup({});
  assert.equal((await handleAuditExport(request("{}", {}, "GET"), deps)).status, 405);
  assert.equal((await handleAuditExport(request("{}", { "x-edge-secret": "wrong" }), deps)).status, 401);
  assert.equal(
    (await handleAuditExport(request("{}", { "x-edge-secret": "" }), { ...deps, sharedSecret: "" })).status,
    401,
  );
  assert.equal(calls.length, 0);
});

Deno.test("a month that is not YYYY-MM is refused before the database is reached", async () => {
  const { calls, deps } = setup({});
  for (
    const body of [
      '{"month":"2026-13"}',
      '{"month":"2026-2"}',
      '{"month":202602}',
      "not json",
      '{"month":"2026-02-01"}',
    ]
  ) {
    assert.equal((await handleAuditExport(request(body), deps)).status, 400, body);
  }
  assert.equal(calls.length, 0);
});

Deno.test("the file holds every row of the previous month in the order of the pages, and the manifest the month, the count and the SHA-256", async () => {
  const { calls, deps, puts, alerts } = setup({
    "POST /rest/v1/rpc/audit_export_month": reply(200, [row(1), row(2), row(3)]),
    "POST /rest/v1/rpc/audit_export_count": reply(200, 3),
  });
  const response = await handleAuditExport(request(), deps);
  assert.equal(response.status, 200);
  const file = [row(1), row(2), row(3)].map((r) => `${JSON.stringify(r)}\n`).join("");
  const sha256 = await sha256Hex(file);
  assert.deepEqual(await response.json(), { month: "2026-02", rows: 3, sha256, status: "archived" });
  assert.deepEqual(puts.map((p) => [p.key, p.contentType]), [
    ["audit-log/2026/2026-02.ndjson", "application/x-ndjson"],
    ["audit-log/2026/2026-02.manifest.json", "application/json"],
  ]);
  assert.equal(puts[0].body, file);
  assert.deepEqual(JSON.parse(puts[1].body), {
    month: "2026-02",
    rows: 3,
    sha256,
    file: "audit-log/2026/2026-02.ndjson",
  });
  assert.deepEqual(rpcNames(calls), ["audit_export_month", "audit_export_count"]);
  assert.deepEqual(calls[0].body, { p_month: "2026-02", p_limit: 1000 });
  assert.deepEqual(alerts, []);
});

Deno.test("a month of more than one page is read page by page from the last row, and the pages are one file", async () => {
  const first = Array.from({ length: 1000 }, (_, i) => row(i + 1));
  const { calls, deps, puts } = setup({
    "POST /rest/v1/rpc/audit_export_month": (call) =>
      reply(200, (call.body as { p_after_id?: number }).p_after_id === undefined ? first : [row(1001)]),
    "POST /rest/v1/rpc/audit_export_count": reply(200, 1001),
  });
  const response = await handleAuditExport(request('{"month":"2026-02"}'), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(calls[1].body, {
    p_month: "2026-02",
    p_limit: 1000,
    p_after_at: row(1000).created_at,
    p_after_id: 1000,
  });
  assert.equal(puts[0].body.split("\n").length - 1, 1001);
  assert.equal(JSON.parse(puts[1].body).rows, 1001);
});

Deno.test("a month without rows still gets a file and a manifest that say 0", async () => {
  const { deps, puts } = setup({
    "POST /rest/v1/rpc/audit_export_month": reply(200, []),
    "POST /rest/v1/rpc/audit_export_count": reply(200, 0),
  });
  const response = await handleAuditExport(request('{"month":"2020-01"}'), deps);
  assert.equal(response.status, 200);
  assert.equal(puts[0].body, "");
  assert.deepEqual(JSON.parse(puts[1].body), {
    month: "2020-01",
    rows: 0,
    sha256: await sha256Hex(""),
    file: "audit-log/2020/2020-01.ndjson",
  });
});

Deno.test("a file that does not match the count of the table is not archived and raises the alert", async () => {
  const { deps, puts, alerts } = setup({
    "POST /rest/v1/rpc/audit_export_month": reply(200, [row(1), row(2)]),
    "POST /rest/v1/rpc/audit_export_count": reply(200, 3),
  });
  const response = await handleAuditExport(request(), deps);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "export_failed" });
  assert.deepEqual(puts, []);
  assert.deepEqual(alerts, [["audit_export_count_mismatch", { month: "2026-02", exported: 2, counted: 3 }]]);
});

Deno.test("a failing read raises the alert with a code and no text, and archives nothing", async () => {
  const { deps, puts, alerts } = setup({
    "POST /rest/v1/rpc/audit_export_month": reply(500, {
      code: "XX000",
      message: "relation audit.log is broken",
      details: null,
      hint: null,
    }),
  });
  const response = await handleAuditExport(request(), deps);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "export_failed" });
  assert.deepEqual(puts, []);
  assert.deepEqual(alerts, [["audit_export_failed", { month: "2026-02", status: undefined, code: "XX000" }]]);
});

Deno.test("a failing archive raises the alert, and the manifest is not written after a file that failed", async () => {
  const { deps, puts, alerts } = setup({
    "POST /rest/v1/rpc/audit_export_month": reply(200, [row(1)]),
    "POST /rest/v1/rpc/audit_export_count": reply(200, 1),
  }, [new ArchiveError(503)]);
  const response = await handleAuditExport(request(), deps);
  assert.equal(response.status, 500);
  assert.equal(puts.length, 1);
  assert.deepEqual(alerts, [["audit_export_failed", { month: "2026-02", status: 503, code: undefined }]]);
});

Deno.test("running a month again after a success archives nothing and says so; after a failure between the objects it writes the missing one", async () => {
  const routes = {
    "POST /rest/v1/rpc/audit_export_month": reply(200, [row(1)]),
    "POST /rest/v1/rpc/audit_export_count": reply(200, 1),
  };
  const again = setup(routes, [false, false]);
  assert.equal((await (await handleAuditExport(request(), again.deps)).json()).status, "already_archived");
  const finish = setup(routes, [false, true]);
  assert.equal((await (await handleAuditExport(request(), finish.deps)).json()).status, "archived");
});

Deno.test("the signature is the one AWS documents for its GET object example", async () => {
  const authorization = await signature(
    {
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    },
    {
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      headers: {
        range: "bytes=0-9",
        "x-amz-content-sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "x-amz-date": "20130524T000000Z",
      },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      amzDate: "20130524T000000Z",
    },
  );
  assert.equal(
    authorization,
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
});

const s3Config = {
  endpoint: "https://s3.eu-west-3.amazonaws.com",
  region: "eu-west-3",
  bucket: "chara-audit",
  accessKeyId: "AKIATEST",
  secretAccessKey: "secret",
  retainDays: 2191,
};

Deno.test("an object is put with the lock, the retention date, the checksum and a signed request that refuses to overwrite", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const archive = s3Archive(s3Config, {
    fetch: (input, init) => {
      seen.push({ url: String(input), init: init as RequestInit });
      return Promise.resolve(new Response(null, { status: 200 }));
    },
    now: () => new Date("2026-03-01T03:00:05Z"),
  });
  const body = encoder.encode("line\n");
  assert.equal(await archive.put("audit-log/2026/2026-02.ndjson", body, "application/x-ndjson"), true);
  assert.equal(seen[0].url, "https://s3.eu-west-3.amazonaws.com/chara-audit/audit-log/2026/2026-02.ndjson");
  const headers = seen[0].init.headers as Record<string, string>;
  assert.equal(seen[0].init.method, "PUT");
  assert.equal(headers["x-amz-object-lock-mode"], "COMPLIANCE");
  assert.equal(headers["x-amz-object-lock-retain-until-date"], "2032-02-29T03:00:05.000Z");
  assert.equal(headers["if-none-match"], "*");
  assert.equal(headers["x-amz-date"], "20260301T030005Z");
  assert.equal(headers["x-amz-content-sha256"], await sha256Hex("line\n"));
  assert.equal(
    headers["x-amz-checksum-sha256"],
    btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", body)))),
  );
  assert.match(
    headers.authorization,
    /^AWS4-HMAC-SHA256 Credential=AKIATEST\/20260301\/eu-west-3\/s3\/aws4_request, SignedHeaders=content-type;host;if-none-match;x-amz-checksum-sha256;x-amz-content-sha256;x-amz-date;x-amz-object-lock-mode;x-amz-object-lock-retain-until-date, Signature=[0-9a-f]{64}$/,
  );
  assert.equal(JSON.stringify(headers).includes("secret"), false);
});

Deno.test("an object that exists is not an error, any other refusal is, and the error carries the status only", async () => {
  const answer = (status: number) =>
    s3Archive(s3Config, {
      fetch: () => Promise.resolve(new Response("<Error>bucket chara-audit</Error>", { status })),
      now: () => new Date(),
    });
  assert.equal(await answer(412).put("k", encoder.encode("x"), "text/plain"), false);
  for (const status of [403, 500, 503]) {
    const error = await answer(status).put("k", encoder.encode("x"), "text/plain").catch((e: unknown) => e);
    assert.ok(error instanceof ArchiveError);
    assert.equal(error.status, status);
    assert.equal(error.message, `archive_${status}`);
  }
});
