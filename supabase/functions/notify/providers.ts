export interface Email {
  // The notification id: the provider treats a second call with the same key as the first, so a retry or a message
  // read again after a crash never sends twice.
  idempotencyKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Provider {
  send(email: Email): Promise<{ id: string }>;
}

export class ProviderError extends Error {
  // A short code that is safe to store: it never holds the provider's text, which can name the address.
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code);
  }
}

const RESEND_URL = "https://api.resend.com/emails";
// A hung connection must not hold a worker: the abort is a network failure, which is retried.
const SEND_TIMEOUT_MS = 10_000;

// Server errors, rate limits, an idempotent request still in flight (409) and a network failure are tried again; any
// other refusal (a bad address, a bad key) would fail the same way.
function retryable(status: number): boolean {
  return status >= 500 || status === 429 || status === 409;
}

export function resendProvider(apiKey: string, fetchFn: typeof fetch = fetch): Provider {
  return {
    async send(email) {
      let response: Response;
      try {
        response = await fetchFn(RESEND_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "idempotency-key": email.idempotencyKey,
          },
          body: JSON.stringify({
            from: email.from,
            to: [email.to],
            subject: email.subject,
            html: email.html,
            text: email.text,
          }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch {
        throw new ProviderError("resend_network", true);
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProviderError(`resend_http_${response.status}`, retryable(response.status));
      }
      const { id } = (await response.json().catch(() => ({}))) as { id?: unknown };
      if (typeof id !== "string" || id === "") {
        throw new ProviderError("resend_bad_response", false);
      }
      return { id };
    },
  };
}

function address(from: string): { Email: string; Name?: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return match ? { Name: match[1] || undefined, Email: match[2] } : { Email: from };
}

// For the local stack and CI: nothing leaves the machine. Every message is kept in `outbox` and, when the address of the
// mail catcher is given, also handed to it through its API so a browser test can read it there.
export function nullProvider(
  catcherUrl?: string,
  fetchFn: typeof fetch = fetch,
): Provider & { outbox: Email[] } {
  const outbox: Email[] = [];
  return {
    outbox,
    async send(email) {
      outbox.push(email);
      if (!catcherUrl) {
        return { id: `null-${email.idempotencyKey}` };
      }
      let response: Response;
      try {
        response = await fetchFn(`${catcherUrl.replace(/\/+$/, "")}/api/v1/send`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            From: address(email.from),
            To: [{ Email: email.to }],
            Subject: email.subject,
            HTML: email.html,
            Text: email.text,
            Headers: { "X-Notification-Id": email.idempotencyKey },
          }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch {
        throw new ProviderError("catcher_network", true);
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProviderError(`catcher_http_${response.status}`, true);
      }
      return { id: `null-${email.idempotencyKey}` };
    },
  };
}
