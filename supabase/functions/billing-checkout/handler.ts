import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultLocale } from "../../../apps/web/lib/i18n/locale.ts";
import { json } from "../_shared/http.ts";
import { type BillingProvider, BillingProviderError } from "../_shared/billing/provider.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BEARER = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/;
const MAX_FIELD = 64;

// The refusals of the database that the page explains to the person; anything else is "forbidden" without a reason.
const REASONS = new Set([
  "aal2_required",
  "organization_suspended",
  "unknown_plan",
  "plan_not_sold",
  "legal_entity_identifier_required",
  "terms_not_published",
  "terms_version_mismatch",
  "already_subscribed",
  "trial_changed",
  "no_customer",
]);
const FIELDS = new Set(["billing_country", "identifier", "vat_id", "registration_number"]);

interface BillingCheckoutDeps {
  userClient: (authorization: string) => SupabaseClient;
  provider: BillingProvider;
  siteUrl: string;
}

interface Checkout {
  action: "checkout";
  orgId: string;
  planCode: string;
  billingCountry: string;
  vatId: string | null;
  registrationNumber: string | null;
  termsVersion: number;
  disclosedTrialDays: number | null;
}

interface Portal {
  action: "portal";
  orgId: string;
}

// The platform has verified the signature (verify_jwt); this only turns away, before any call, a token that cannot be
// a signed-in person's: the publishable key, an anonymous token, an expired one. What the person may do is the
// database's to say.
function isSignedIn(authorization: string): boolean {
  const payload = BEARER.exec(authorization)?.[2];
  if (!payload) {
    return false;
  }
  try {
    const claims: unknown = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/")));
    return isObject(claims) && claims.role === "authenticated" && typeof claims.sub === "string" &&
      typeof claims.exp === "number" && claims.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === "string" && value.length <= MAX_FIELD ? value : undefined;
}

// Only what the call needs is read from the body: the customer reference and the return addresses come from the
// database and from the function's own settings, never from the caller.
function parse(body: unknown): Checkout | Portal | null {
  if (!isObject(body) || typeof body.orgId !== "string" || !UUID.test(body.orgId)) {
    return null;
  }
  if (body.action === "portal") {
    return { action: "portal", orgId: body.orgId };
  }
  const vatId = text(body.vatId);
  const registrationNumber = text(body.registrationNumber);
  const { planCode, billingCountry, termsVersion, disclosedTrialDays } = body;
  if (
    body.action !== "checkout" || typeof planCode !== "string" || planCode.length > MAX_FIELD ||
    typeof billingCountry !== "string" || billingCountry.length > MAX_FIELD || vatId === undefined ||
    registrationNumber === undefined || !Number.isInteger(termsVersion) || (termsVersion as number) < 0 ||
    (disclosedTrialDays !== undefined && disclosedTrialDays !== null &&
      (!Number.isInteger(disclosedTrialDays) || (disclosedTrialDays as number) < 0))
  ) {
    return null;
  }
  return {
    action: "checkout",
    orgId: body.orgId,
    planCode,
    billingCountry,
    vatId,
    registrationNumber,
    termsVersion: termsVersion as number,
    disclosedTrialDays: (disclosedTrialDays as number | null | undefined) ?? null,
  };
}

function refusal(error: { code?: string; message?: string; details?: string | null }): Response {
  const { code = "", message = "", details = null } = error;
  // The publishable key as a bearer, a role without the grant, a user id missing from the token, an expired token.
  if (message === "CHARA_UNAUTHENTICATED" || message.startsWith("permission denied") || code.startsWith("PGRST30")) {
    return json(401, { error: "unauthorized" });
  }
  if (message === "CHARA_FORBIDDEN") {
    return json(403, { error: "forbidden", reason: details && REASONS.has(details) ? details : null });
  }
  if (message === "CHARA_INVALID_INPUT" || code === "22023" || code === "22P02") {
    return json(400, { error: "bad_request", field: details && FIELDS.has(details) ? details : null });
  }
  console.error("billing-checkout failed", { code: code.slice(0, 16) });
  return json(502, { error: "unavailable" });
}

type Row = Record<string, string | number | null>;

function firstRow(data: unknown): Row | null {
  return Array.isArray(data) && isObject(data[0]) ? (data[0] as Row) : null;
}

async function startCheckout(client: SupabaseClient, request: Checkout, deps: BillingCheckoutDeps): Promise<Response> {
  const { data, error } = await client.rpc("billing_checkout_start", {
    p_org: request.orgId,
    p_plan_code: request.planCode,
    p_billing_country: request.billingCountry,
    p_vat_id: request.vatId,
    p_registration_number: request.registrationNumber,
    p_terms_version: request.termsVersion,
    p_provider: deps.provider.name,
    p_disclosed_trial_days: request.disclosedTrialDays,
  });
  const row = firstRow(data);
  if (error || !row) {
    return error ? refusal(error) : json(502, { error: "unavailable" });
  }
  const billingUrl = returnUrl(deps.siteUrl, String(row.slug));
  const { url } = await deps.provider.createCheckout({
    orgId: request.orgId,
    planCode: request.planCode,
    priceRef: row.price_ref as string | null,
    trialDays: row.trial_days as number,
    successUrl: billingUrl,
    cancelUrl: billingUrl,
    customerRef: (row.customer_ref as string | null) ?? undefined,
  });
  return json(200, { url });
}

async function startPortal(client: SupabaseClient, request: Portal, deps: BillingCheckoutDeps): Promise<Response> {
  const { data, error } = await client.rpc("billing_portal_start", { p_org: request.orgId });
  const row = firstRow(data);
  if (error || !row) {
    return error ? refusal(error) : json(502, { error: "unavailable" });
  }
  const { url } = await deps.provider.createPortal({
    customerRef: String(row.customer_ref),
    returnUrl: returnUrl(deps.siteUrl, String(row.slug)),
  });
  return json(200, { url });
}

function returnUrl(siteUrl: string, slug: string): string {
  return `${new URL(siteUrl).origin}/${defaultLocale}/org/${slug}/billing`;
}

export async function handleBillingCheckout(req: Request, deps: BillingCheckoutDeps): Promise<Response> {
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }
  const authorization = req.headers.get("authorization") ?? "";
  if (!isSignedIn(authorization)) {
    return json(401, { error: "unauthorized" });
  }
  const request = parse(await req.json().catch(() => null));
  if (!request) {
    return json(400, { error: "bad_request", field: null });
  }

  const client = deps.userClient(authorization);
  try {
    return request.action === "portal"
      ? await startPortal(client, request, deps)
      : await startCheckout(client, request, deps);
  } catch (e) {
    console.error("billing-checkout provider failed", { code: e instanceof BillingProviderError ? e.code : "unknown" });
    return json(502, { error: "unavailable" });
  }
}
