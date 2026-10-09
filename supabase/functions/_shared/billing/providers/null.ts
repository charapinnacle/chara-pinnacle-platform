import {
  assertAppOrigin,
  type BillingProvider,
  EVENT_KINDS,
  isObject,
  type NormalizedEvent,
  type WebhookVerification,
} from "../provider.ts";
import { hmacMatches } from "../signature.ts";

// For the local stack and CI: no account and no network. The hosted pages are addresses on a host that cannot exist
// (RFC 6761), so a test can intercept the redirect and nothing leaves the machine.
const HOSTED = "https://null-provider.invalid";

// The body of a delivery is {"id": <event id>, "event": <an event already in the normalised form>}, signed with
// BILLING_WEBHOOK_SECRET in the header x-chara-signature (hex HMAC-SHA256 of the raw body).
async function verify(req: Request, rawBody: string, secret: string | undefined): Promise<WebhookVerification> {
  if (!secret) {
    return { ok: false, reason: "not_configured" };
  }
  const signature = req.headers.get("x-chara-signature");
  if (!signature) {
    return { ok: false, reason: "missing_signature" };
  }
  if (!await hmacMatches(secret, rawBody, signature)) {
    return { ok: false, reason: "signature_mismatch" };
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }
  const id = isObject(body) ? body.id : undefined;
  const event = isObject(body) ? body.event : undefined;
  if (typeof id !== "string" || id === "" || id.length > 255 || !isObject(event) || typeof event.kind !== "string") {
    return { ok: false, reason: "invalid_payload" };
  }
  return { ok: true, eventId: id, type: event.kind, payload: event };
}

export function nullProvider(siteUrl: string, webhookSecret?: string): BillingProvider {
  return {
    name: "null",
    createCheckout(input) {
      return Promise.resolve().then(() => {
        assertAppOrigin(siteUrl, input.successUrl, input.cancelUrl);
        const query = new URLSearchParams({ success_url: input.successUrl, cancel_url: input.cancelUrl });
        return { url: `${HOSTED}/checkout/null_cs_${crypto.randomUUID()}?${query}` };
      });
    },
    createPortal(input) {
      return Promise.resolve().then(() => {
        assertAppOrigin(siteUrl, input.returnUrl);
        const query = new URLSearchParams({ return_url: input.returnUrl });
        return { url: `${HOSTED}/portal/${encodeURIComponent(input.customerRef)}?${query}` };
      });
    },
    verifyWebhook: (req, rawBody) => verify(req, rawBody, webhookSecret),
    normalize(payload) {
      const valid = isObject(payload) && EVENT_KINDS.includes(payload.kind as NormalizedEvent["kind"]) &&
        typeof payload.providerCreatedAt === "string" && !Number.isNaN(Date.parse(payload.providerCreatedAt));
      return valid ? [payload as NormalizedEvent] : [];
    },
    fetchSubscription: () => Promise.resolve(null),
    listSubscriptions: () => Promise.resolve({ subscriptions: [], next: null }),
  };
}
