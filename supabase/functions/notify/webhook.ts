// Resend signs its webhooks with Svix: HMAC-SHA256 over "{id}.{timestamp}.{body}" with the base64 key after "whsec_",
// sent as "v1,{signature}" (several, space separated, while a key is being rotated).
const TOLERANCE_SECONDS = 300;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function decode(base64: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64.test(base64)) {
    return null;
  }
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// Compares without an early exit.
function equal(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) {
    diff |= (a[i] ?? 0) ^ b[i];
  }
  return diff === 0;
}

export async function verifySignature(
  headers: Headers,
  body: string,
  secret: string,
  nowSeconds: number,
): Promise<boolean> {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  const keyBytes = secret.startsWith("whsec_") ? decode(secret.slice(6)) : null;
  if (!id || !timestamp || !signatures || !keyBytes || keyBytes.length === 0 || !/^\d{1,12}$/.test(timestamp)) {
    return false;
  }
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)),
  );
  let valid = false;
  for (const candidate of signatures.split(" ")) {
    const [version, value] = candidate.split(",");
    const bytes = version === "v1" && value ? decode(value) : null;
    if (bytes && equal(bytes, expected)) {
      valid = true;
    }
  }
  return valid;
}

export type DeliveryOutcome = "delivered" | "bounced_transient" | "bounced_permanent" | "complained";

const EVENTS: Record<string, DeliveryOutcome | undefined> = {
  "email.delivered": "delivered",
  "email.complained": "complained",
  "email.bounced": "bounced_transient",
};

// "ignored" is an event that changes nothing recorded (sent, delayed, opened, clicked); null is a payload that is not an
// event of the provider at all.
export function deliveryEvent(
  body: unknown,
): { outcome: DeliveryOutcome; providerMessageId: string } | "ignored" | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { type, data } = body as { type?: unknown; data?: { email_id?: unknown; bounce?: { type?: unknown } } };
  if (typeof type !== "string") {
    return null;
  }
  const outcome = EVENTS[type];
  if (!outcome) {
    return "ignored";
  }
  const providerMessageId = data?.email_id;
  if (typeof providerMessageId !== "string" || providerMessageId === "") {
    return null;
  }
  return {
    outcome: outcome === "bounced_transient" && data?.bounce?.type === "Permanent" ? "bounced_permanent" : outcome,
    providerMessageId,
  };
}
