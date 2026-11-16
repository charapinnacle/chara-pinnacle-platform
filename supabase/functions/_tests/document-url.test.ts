import assert from "node:assert/strict";
import { handleDocumentUrl } from "../document-url/handler.ts";
import { harness, reply, type Route } from "./harness.ts";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2ln";
const DOCUMENT = "00000000-0000-0000-0000-0000000d0001";
const PATH = "00000000-0000-0000-0000-00000000a101/00000000-0000-0000-0000-0000000d0001/My_CV__final_.pdf";
const GRANT = "POST /rest/v1/rpc/document_access_grant";
const SIGN = "POST /storage/v1/object/sign/passport-documents/{id}/{id}/My_CV__final_.pdf";

const granted = reply(200, [{ bucket_id: "passport-documents", object_path: PATH, file_name: "My_CV__final_.pdf" }]);
const signed = reply(200, { signedURL: `/object/sign/passport-documents/${PATH}?token=t0k3n` });
const database = (message: string, code: string) => reply(400, { code, message, details: null, hint: null });

function request(
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` },
  method = "POST",
) {
  return new Request("http://stack.test/functions/v1/document-url", {
    method,
    headers,
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
}

function run(req: Request, grant: Route | Response, sign: Route | Response = signed) {
  const user = harness({ [GRANT]: grant });
  const signer = harness({ [SIGN]: sign });
  const seen: string[] = [];
  return {
    user,
    signer,
    seen,
    response: handleDocumentUrl(req, {
      userClient: (authorization) => {
        seen.push(authorization);
        return user.client;
      },
      signer: signer.client,
    }),
  };
}

const ask = { documentId: DOCUMENT, purpose: "application_review" };

Deno.test("a grant gives a 60-second download link for the path the grant returned, and nothing else", async () => {
  const { user, signer, seen, response } = run(request(ask), granted);
  const result = await response;
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  const body = await result.json();
  assert.deepEqual(Object.keys(body), ["url"]);
  assert.ok(body.url.includes("token=t0k3n") && body.url.includes("download=My_CV__final_.pdf"), body.url);
  assert.deepEqual(seen, [`Bearer ${TOKEN}`], "the grant runs with the caller's own token");
  assert.deepEqual(user.calls.map((c) => c.body), [{ p_document_id: DOCUMENT, p_purpose: "application_review" }]);
  assert.deepEqual(signer.calls.map((c) => [c.method, c.body]), [["POST", { expiresIn: 60 }]]);
});

Deno.test("without a bearer token of three parts nothing is called: 401", async () => {
  const unauthenticated: Record<string, string>[] = [
    {},
    { authorization: "" },
    { authorization: TOKEN },
    { authorization: "Bearer abc" },
    { authorization: "Basic a.b.c" },
  ];
  for (const headers of unauthenticated) {
    const { user, signer, seen, response } = run(request(ask, headers), granted);
    const result = await response;
    assert.equal(result.status, 401, JSON.stringify(headers));
    assert.deepEqual(await result.json(), { error: "unauthorized" });
    assert.deepEqual([user.calls.length, signer.calls.length, seen.length], [0, 0, 0]);
  }
});

Deno.test("only POST is served, and a malformed request is refused before the database is asked", async () => {
  const cases: [Request, number][] = [
    [request({}, undefined, "GET"), 405],
    [request("not json{"), 400],
    [request(null), 400],
    [request([]), 400],
    [request({ purpose: "application_review" }), 400],
    [request({ documentId: "not-a-uuid", purpose: "application_review" }), 400],
    [request({ documentId: `${DOCUMENT}/../x`, purpose: "application_review" }), 400],
    [request({ documentId: DOCUMENT }), 400],
    [request({ documentId: DOCUMENT, purpose: 5 }), 400],
  ];
  for (const [req, status] of cases) {
    const { user, signer, response } = run(req, granted);
    assert.equal((await response).status, status);
    assert.deepEqual([user.calls.length, signer.calls.length], [0, 0]);
  }
});

Deno.test("each refusal of the grant is a status and a word, with no link, no path and no database text", async () => {
  const cases: [Response, number, string][] = [
    [database("CHARA_FORBIDDEN", "42501"), 403, "forbidden"],
    [database("CHARA_NOT_FOUND", "P0002"), 404, "not_found"],
    [database("CHARA_DOCUMENT_NOT_SCANNED", "P0001"), 409, "not_scanned"],
    [database("CHARA_RATE_LIMITED", "P0001"), 429, "rate_limited"],
    [database("CHARA_UNAUTHENTICATED", "42501"), 401, "unauthorized"],
    [database("permission denied for function document_access_grant", "42501"), 401, "unauthorized"],
    [database("JWT expired", "PGRST301"), 401, "unauthorized"],
    [database("invalid input syntax for type uuid", "22P02"), 400, "bad_request"],
    [database('null value in column "purpose"', "23502"), 400, "bad_request"],
    [database("new row violates check constraint", "23514"), 400, "bad_request"],
  ];
  for (const [grant, status, word] of cases) {
    const { signer, response } = run(request(ask), grant);
    const result = await response;
    const text = await result.text();
    assert.equal(result.status, status, text);
    assert.deepEqual(JSON.parse(text), { error: word });
    assert.ok(!text.includes("url") && !text.includes(PATH) && !text.includes("CHARA_"));
    assert.equal(signer.calls.length, 0, "nothing is signed for a refused call");
  }
});

Deno.test("an unexpected database error is a 502 that logs a bounded code and nothing else", async () => {
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => logged.push(args);
  let text = "";
  try {
    const { signer, response } = run(request(ask), database(`secret internals ${PATH}`, "XX000"));
    const result = await response;
    assert.equal(result.status, 502);
    text = await result.text();
    assert.equal(signer.calls.length, 0);
  } finally {
    console.error = original;
  }
  assert.deepEqual(JSON.parse(text), { error: "unavailable" });
  assert.ok(!text.includes("secret") && !text.includes(PATH));
  assert.deepEqual(logged, [["document-url failed", { code: "XX000" }]]);
});

Deno.test("a grant that returns no row, or a failure to sign, gives a 502 without a link", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    for (
      const [grant, sign] of [[reply(200, []), signed], [granted, reply(500, { message: "storage down" })]] as const
    ) {
      const { response } = run(request(ask), grant, sign);
      const result = await response;
      assert.equal(result.status, 502);
      assert.deepEqual(await result.json(), { error: "unavailable" });
    }
  } finally {
    console.error = original;
  }
});

// Licence evidence (FR-J2): uploads by the owner or an admin, openings by staff, through partner_document_access_grant.
const LICENCE = "00000000-0000-0000-0000-0000000c0001";
const EVIDENCE = `00000000-0000-0000-0000-0000000b0001/${LICENCE}/00000000-0000-0000-0000-0000000f0001`;
const EVIDENCE_GRANT = "POST /rest/v1/rpc/partner_document_access_grant";
const EVIDENCE_SIGN = "POST /storage/v1/object/sign/partner-documents/{id}/{id}/{id}";
const EVIDENCE_UPLOAD_SIGN = "POST /storage/v1/object/upload/sign/partner-documents/{id}/{id}/{id}";

function runEvidence(req: Request, grant: Response) {
  const user = harness({ [EVIDENCE_GRANT]: grant });
  const signer = harness({
    [EVIDENCE_SIGN]: reply(200, { signedURL: `/object/sign/partner-documents/${EVIDENCE}?token=r34d` }),
    [EVIDENCE_UPLOAD_SIGN]: reply(200, { url: `/object/upload/sign/partner-documents/${EVIDENCE}?token=upl0ad` }),
  });
  return {
    user,
    signer,
    response: handleDocumentUrl(req, { userClient: () => user.client, signer: signer.client }),
  };
}

Deno.test("an evidence upload grant gives an upload URL for the reserved name only, never a download link", async () => {
  const { user, signer, response } = runEvidence(
    request({ licenceId: LICENCE, purpose: "evidence_upload", mime: "application/pdf", size: 15728640 }),
    reply(200, [{ bucket_id: "partner-documents", object_path: EVIDENCE, file_name: null }]),
  );
  const result = await response;
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { path: EVIDENCE, token: "upl0ad" });
  assert.deepEqual(user.calls.map((c) => c.body), [
    { p_licence: LICENCE, p_purpose: "evidence_upload", p_mime: "application/pdf", p_size: 15728640 },
  ]);
  assert.deepEqual(signer.calls.map((c) => [c.method, c.path]), [
    ["POST", `/storage/v1/object/upload/sign/partner-documents/${EVIDENCE}`],
  ]);
});

Deno.test("a staff opening of licence evidence gives a 60-second download link", async () => {
  const { user, signer, response } = runEvidence(
    request({ licenceId: LICENCE, purpose: "partner_review" }),
    reply(200, [{ bucket_id: "partner-documents", object_path: EVIDENCE, file_name: "licence-ph.pdf" }]),
  );
  const result = await response;
  assert.equal(result.status, 200);
  const { url } = await result.json();
  assert.ok(url.includes("token=r34d") && url.includes("download=licence-ph.pdf"), url);
  assert.deepEqual(user.calls.map((c) => c.body), [{ p_licence: LICENCE, p_purpose: "partner_review" }]);
  assert.deepEqual(signer.calls.map((c) => [c.path, c.body]), [
    [`/storage/v1/object/sign/partner-documents/${EVIDENCE}`, { expiresIn: 60 }],
  ]);
});

Deno.test("an evidence request that names both ids, or an upload without an integer size and a type, is refused first", async () => {
  for (
    const body of [
      { documentId: DOCUMENT, licenceId: LICENCE, purpose: "partner_review" },
      { licenceId: "not-a-uuid", purpose: "partner_review" },
      { licenceId: LICENCE },
      { licenceId: LICENCE, purpose: "evidence_upload", mime: "application/pdf" },
      { licenceId: LICENCE, purpose: "evidence_upload", size: 10 },
      { licenceId: LICENCE, purpose: "evidence_upload", mime: "application/pdf", size: 1.5 },
      { licenceId: LICENCE, purpose: "evidence_upload", mime: "x".repeat(101), size: 10 },
    ]
  ) {
    const { user, signer, response } = runEvidence(request(body), reply(200, []));
    assert.equal((await response).status, 400, JSON.stringify(body));
    assert.deepEqual([user.calls.length, signer.calls.length], [0, 0]);
  }
});

Deno.test("evidence refusals: a refused file, an unscanned file, an outsider and a member are told apart without detail", async () => {
  const cases: [Response, number, string][] = [
    [reply(400, { code: "P0001", message: "CHARA_INVALID_INPUT", details: "file", hint: null }), 400, "invalid_file"],
    [reply(400, { code: "P0001", message: "CHARA_INVALID_INPUT", details: "purpose", hint: null }), 400, "bad_request"],
    [database("CHARA_DOCUMENT_NOT_SCANNED", "P0001"), 409, "not_scanned"],
    [database("CHARA_NOT_FOUND", "P0002"), 404, "not_found"],
    [database("CHARA_FORBIDDEN", "P0001"), 403, "forbidden"],
  ];
  for (const [grant, status, word] of cases) {
    const { signer, response } = runEvidence(
      request({ licenceId: LICENCE, purpose: "evidence_upload", mime: "image/svg+xml", size: 10 }),
      grant,
    );
    const result = await response;
    assert.equal(result.status, status);
    assert.deepEqual(await result.json(), { error: word });
    assert.equal(signer.calls.length, 0);
  }
});

Deno.test("the owner or an admin opening the own licence evidence gets a 60-second download link", async () => {
  const { user, signer, response } = runEvidence(
    request({ licenceId: LICENCE, purpose: "evidence_owner" }),
    reply(200, [{ bucket_id: "partner-documents", object_path: EVIDENCE, file_name: "licence-ph.pdf" }]),
  );
  const result = await response;
  assert.equal(result.status, 200);
  assert.ok((await result.json()).url.includes("download=licence-ph.pdf"));
  assert.deepEqual(user.calls.map((c) => c.body), [{ p_licence: LICENCE, p_purpose: "evidence_owner" }]);
  assert.deepEqual(signer.calls.map((c) => c.body), [{ expiresIn: 60 }]);
});
