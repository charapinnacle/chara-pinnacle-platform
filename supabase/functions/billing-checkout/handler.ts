import type { SupabaseClient } from "@supabase/supabase-js";
import { signedInUser } from "../_shared/auth.ts";
import { isObject, json } from "../_shared/http.ts";
import { type BillingProvider, BillingProviderError } from "../_shared/billing/provider.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FIELD = 64;
const MAX_TERMS_VERSION = 1_000_000;
const MAX_TRIAL_DAYS = 365;
// The return addresses are fixed by FR-G2 AC8: the billing page of the organization in the default locale.
const RETURN_LOCALE = "en";

// The refusals of the database that the page explains to the person; anything else is "forbidden" without a reason.
const REASONS = new Set([
  "aal2_required",
  "organization_suspended",
  "unknown_plan",
  "plan_not_for_org_type",
  "plan_not_sold",
  "legal_entity_identifier_required",
  "terms_not_published",
  "terms_version_mismatch",
  "already_subscribed",
  "no_customer",
  "portal_not_configured",
  "boosts_off",
  "unknown_product",
  "product_not_for_org_type",
  "product_not_sold",
  "not_listed",
]);
const FIELDS = new Set(["billing_country", "identifier", "vat_id", "registration_number"]);
// FR-G6: the database refuses a worker account with this detail. The answer to the caller is the generic one (it is not
// in REASONS); the attempt is recorded so that the refusals can be counted.
const WORKER_ACCOUNT = "worker_account";

export type OrganizationType = "employer" | "recruitment_company" | "staffing_company";

// The portal configuration of each organisation type at the provider, which lists only that type's products.
export type PortalConfigurations = Partial<Record<OrganizationType, string>>;

interface BillingCheckoutDeps {
  userClient: (authorization: string) => SupabaseClient;
  serviceClient: SupabaseClient;
  provider: Pick<BillingProvider, "name" | "createCheckout" | "createPaymentCheckout" | "createPortal">;
  siteUrl: string;
  portalConfigurations: PortalConfigurations;
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

interface Boost {
  action: "boost";
  orgId: string;
  sku: string;
}

function isBoundedInteger(value: unknown, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;
}

// null for a value that was left out, undefined for one that cannot be accepted.
function text(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === "string" && value.length <= MAX_FIELD ? value : undefined;
}

// Only what the call needs is read from the body: the customer reference and the return addresses come from the
// database and from the function's own settings, never from the caller.
function parse(body: unknown): Checkout | Portal | Boost | null {
  if (!isObject(body) || typeof body.orgId !== "string" || !UUID.test(body.orgId)) {
    return null;
  }
  if (body.action === "portal") {
    return { action: "portal", orgId: body.orgId };
  }
  if (body.action === "boost") {
    return typeof body.sku === "string" && body.sku.length <= MAX_FIELD
      ? { action: "boost", orgId: body.orgId, sku: body.sku }
      : null;
  }
  const vatId = text(body.vatId);
  const registrationNumber = text(body.registrationNumber);
  const { planCode, billingCountry, termsVersion, disclosedTrialDays } = body;
  if (
    body.action !== "checkout" || typeof planCode !== "string" || planCode.length > MAX_FIELD ||
    typeof billingCountry !== "string" || billingCountry.length > MAX_FIELD || vatId === undefined ||
    registrationNumber === undefined || !isBoundedInteger(termsVersion, MAX_TERMS_VERSION) ||
    (disclosedTrialDays !== undefined && disclosedTrialDays !== null &&
      !isBoundedInteger(disclosedTrialDays, MAX_TRIAL_DAYS))
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

type DatabaseError = { code?: string; message?: string; details?: string | null };

function refusal(error: DatabaseError): Response {
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

// The database rolls the refused call back, so nothing else records it. The database bounds the records per person and
// window; the answer does not depend on the record: a failed write is logged and the refusal stands.
async function answer(error: DatabaseError, userId: string, deps: BillingCheckoutDeps): Promise<Response> {
  if (error.message === "CHARA_FORBIDDEN" && error.details === WORKER_ACCOUNT) {
    const { error: auditError } = await deps.serviceClient.rpc("billing_record_worker_attempt", { p_user: userId });
    if (auditError) {
      console.error("billing-checkout could not record a worker attempt", {
        code: (auditError.code ?? "").slice(0, 16),
      });
    }
  }
  return refusal(error);
}

function firstRow(data: unknown): Row | null {
  return Array.isArray(data) && isObject(data[0]) ? (data[0] as Row) : null;
}

async function startCheckout(
  client: SupabaseClient,
  userId: string,
  request: Checkout,
  deps: BillingCheckoutDeps,
): Promise<Response> {
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
    return error ? answer(error, userId, deps) : json(502, { error: "unavailable" });
  }
  const trialDays = row.trial_days as number;
  if (request.disclosedTrialDays !== null && request.disclosedTrialDays !== trialDays) {
    return json(409, { error: "trial_changed", reason: "trial_changed" });
  }
  const billingUrl = returnUrl(deps.siteUrl, String(row.slug));
  const { url } = await deps.provider.createCheckout({
    orgId: request.orgId,
    planCode: request.planCode,
    priceRef: row.price_ref as string | null,
    trialDays,
    successUrl: billingUrl,
    cancelUrl: billingUrl,
    customerRef: (row.customer_ref as string | null) ?? undefined,
  });
  return json(200, { url });
}

async function startPortal(
  client: SupabaseClient,
  userId: string,
  request: Portal,
  deps: BillingCheckoutDeps,
): Promise<Response> {
  const { data, error } = await client.rpc("billing_portal_start", { p_org: request.orgId });
  const row = firstRow(data);
  if (error || !row) {
    return error ? answer(error, userId, deps) : json(502, { error: "unavailable" });
  }
  const type = row.organization_type;
  const configuration = isOrganizationType(type) ? deps.portalConfigurations[type] : undefined;
  // Stripe's default portal configuration lists the employer products, so a partner's portal without its own
  // configuration would offer it plans of another type: it is refused instead (the go-live check requires the
  // configurations while release 2a is on). The employer portal keeps the default when no configuration is set.
  if (!configuration && type !== "employer" && deps.provider.name === "stripe") {
    console.error("billing-checkout portal not configured", { type });
    return json(503, { error: "unavailable", reason: "portal_not_configured" });
  }
  const { url } = await deps.provider.createPortal({
    customerRef: String(row.customer_ref),
    returnUrl: returnUrl(deps.siteUrl, String(row.slug)),
    ...(configuration ? { configuration } : {}),
  });
  return json(200, { url });
}

// A boost is a one-time payment of the product the database names; the person comes back to the boost page.
async function startBoost(
  client: SupabaseClient,
  userId: string,
  request: Boost,
  deps: BillingCheckoutDeps,
): Promise<Response> {
  const { data, error } = await client.rpc("billing_boost_checkout_start", {
    p_org: request.orgId,
    p_sku: request.sku,
    p_provider: deps.provider.name,
  });
  const row = firstRow(data);
  if (error || !row) {
    return error ? answer(error, userId, deps) : json(502, { error: "unavailable" });
  }
  const boostUrl = `${new URL(deps.siteUrl).origin}/${RETURN_LOCALE}/org/${String(row.slug)}/boost`;
  const { url } = await deps.provider.createPaymentCheckout({
    orgId: request.orgId,
    sku: request.sku,
    productName: `Profile boost, ${Number(row.days)} days`,
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency),
    successUrl: boostUrl,
    cancelUrl: boostUrl,
    customerRef: (row.customer_ref as string | null) ?? undefined,
  });
  return json(200, { url });
}

function isOrganizationType(value: unknown): value is OrganizationType {
  return value === "employer" || value === "recruitment_company" || value === "staffing_company";
}

function returnUrl(siteUrl: string, slug: string): string {
  return `${new URL(siteUrl).origin}/${RETURN_LOCALE}/org/${slug}/billing`;
}

export async function handleBillingCheckout(req: Request, deps: BillingCheckoutDeps): Promise<Response> {
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }
  const authorization = req.headers.get("authorization") ?? "";
  const userId = signedInUser(authorization);
  if (!userId) {
    return json(401, { error: "unauthorized" });
  }
  const request = parse(await req.json().catch(() => null));
  if (!request) {
    return json(400, { error: "bad_request", field: null });
  }

  const client = deps.userClient(authorization);
  try {
    if (request.action === "portal") {
      return await startPortal(client, userId, request, deps);
    }
    return request.action === "boost"
      ? await startBoost(client, userId, request, deps)
      : await startCheckout(client, userId, request, deps);
  } catch (e) {
    console.error("billing-checkout provider failed", { code: e instanceof BillingProviderError ? e.code : "unknown" });
    return json(502, { error: "unavailable" });
  }
}
