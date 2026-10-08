import assert from "node:assert/strict";
import { nullProvider, ProviderError, resendProvider } from "../notify/providers.ts";

const EMAIL = {
  idempotencyKey: "00000000-0000-4000-8000-0000000000a1",
  from: "CHARA <noreply@chara.example>",
  to: "amina@example.test",
  subject: "Subject",
  html: "<p>Hi</p>",
  text: "Hi",
};

interface Seen {
  url: string;
  init: RequestInit;
}

function fetching(response: Response | Error): { fetchFn: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchFn: typeof fetch = (input, init) => {
    seen.push({ url: String(input), init: init ?? {} });
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response.clone());
  };
  return { fetchFn, seen };
}

const failureOf = async (run: () => Promise<unknown>) =>
  await run().then(() => null, (e: unknown) => e as ProviderError);

Deno.test("Resend is called with the key, the idempotency key and the message", async () => {
  const { fetchFn, seen } = fetching(Response.json({ id: "re_123" }));
  const result = await resendProvider("re_key", fetchFn).send(EMAIL);
  assert.deepEqual(result, { id: "re_123" });
  assert.equal(seen[0].url, "https://api.resend.com/emails");
  assert.equal(seen[0].init.method, "POST");
  const headers = seen[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer re_key");
  assert.equal(headers["idempotency-key"], EMAIL.idempotencyKey);
  assert.deepEqual(JSON.parse(seen[0].init.body as string), {
    from: EMAIL.from,
    to: [EMAIL.to],
    subject: "Subject",
    html: "<p>Hi</p>",
    text: "Hi",
  });
});

Deno.test("Resend failures become short codes, retried only when a retry can help", async () => {
  const cases: [number, string, boolean][] = [
    [500, "resend_http_500", true],
    [503, "resend_http_503", true],
    [429, "resend_http_429", true],
    [409, "resend_http_409", true],
    [422, "resend_http_422", false],
    [401, "resend_http_401", false],
    [400, "resend_http_400", false],
  ];
  for (const [status, code, retryable] of cases) {
    const { fetchFn } = fetching(
      Response.json({ name: "x", message: "the address amina@example.test is invalid" }, { status }),
    );
    const error = await failureOf(() => resendProvider("k", fetchFn).send(EMAIL));
    assert.equal(error?.code, code);
    assert.equal(error?.retryable, retryable, code);
    assert.ok(!error?.message.includes("amina"), "the provider text is not kept");
  }
  const network = await failureOf(() => resendProvider("k", fetching(new TypeError("down")).fetchFn).send(EMAIL));
  assert.deepEqual([network?.code, network?.retryable], ["resend_network", true]);
  const noId = await failureOf(() => resendProvider("k", fetching(Response.json({})).fetchFn).send(EMAIL));
  assert.deepEqual([noId?.code, noId?.retryable], ["resend_bad_response", false]);
});

Deno.test("the null provider keeps every message and sends nothing anywhere without a catcher", async () => {
  const provider = nullProvider();
  const result = await provider.send(EMAIL);
  assert.deepEqual(result, { id: `null-${EMAIL.idempotencyKey}` });
  assert.deepEqual(provider.outbox, [EMAIL]);
});

Deno.test("the null provider hands the message to the mail catcher when it is given one", async () => {
  const { fetchFn, seen } = fetching(Response.json({ ID: "abc" }));
  const provider = nullProvider("http://127.0.0.1:54424/", fetchFn);
  await provider.send(EMAIL);
  assert.equal(seen[0].url, "http://127.0.0.1:54424/api/v1/send");
  assert.deepEqual(JSON.parse(seen[0].init.body as string), {
    From: { Name: "CHARA", Email: "noreply@chara.example" },
    To: [{ Email: EMAIL.to }],
    Subject: "Subject",
    HTML: "<p>Hi</p>",
    Text: "Hi",
    Headers: { "X-Notification-Id": EMAIL.idempotencyKey },
  });
  assert.equal(provider.outbox.length, 1);
  const plain = fetching(Response.json({ ID: "abc" }));
  await nullProvider("http://catcher.test", plain.fetchFn).send({ ...EMAIL, from: "noreply@chara.example" });
  assert.deepEqual(JSON.parse(plain.seen[0].init.body as string).From, { Email: "noreply@chara.example" });
});

Deno.test("a catcher that is down is a failure that can be tried again", async () => {
  const refused = await failureOf(() =>
    nullProvider("http://catcher.test", fetching(new Response("no", { status: 500 })).fetchFn).send(EMAIL)
  );
  assert.deepEqual([refused?.code, refused?.retryable], ["catcher_http_500", true]);
  const down = await failureOf(() =>
    nullProvider("http://catcher.test", fetching(new TypeError("refused")).fetchFn).send(EMAIL)
  );
  assert.deepEqual([down?.code, down?.retryable], ["catcher_network", true]);
});

Deno.test("both providers give up on a connection that never answers, as a network failure that is retried", async () => {
  const original = AbortSignal.timeout;
  const requested: number[] = [];
  AbortSignal.timeout = (ms) => {
    requested.push(ms);
    return original.call(AbortSignal, 20);
  };
  const hanging: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
  try {
    const resend = await failureOf(() => resendProvider("re_key", hanging).send(EMAIL));
    assert.deepEqual([resend?.code, resend?.retryable], ["resend_network", true]);
    const catcher = await failureOf(() => nullProvider("http://catcher.test", hanging).send(EMAIL));
    assert.deepEqual([catcher?.code, catcher?.retryable], ["catcher_network", true]);
    assert.deepEqual(requested, [10_000, 10_000]);
  } finally {
    AbortSignal.timeout = original;
  }
});
