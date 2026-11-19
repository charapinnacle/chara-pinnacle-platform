import type { SupabaseClient } from "@supabase/supabase-js";
import { signedInUser } from "../_shared/auth.ts";
import { isObject, json } from "../_shared/http.ts";
import { type BillingProvider, errorCode } from "../_shared/billing/provider.ts";

const PLAN_CODE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const MAX_PLAN_CODE = 64;
// FR-R2 data and validation: an integer number of minor units from 100 to 10,000,000, and a reason of 10 to 500
// characters after trimming. They are checked here as well as in the database, because a refusal after the provider
// call would leave a price at the provider that no plan uses.
const MIN_PRICE = 100;
const MAX_PRICE = 10_000_000;
const MIN_REASON = 10;
const MAX_REASON = 500;
const REASON_TRIM = /^[ \t\r\n]+|[ \t\r\n]+$/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The refusals of the database that the console explains; anything else is "forbidden" or "bad request" without one.
const REASONS = new Set(["aal2_required", "plan_not_synced"]);
const FIELDS = new Set(["plan_code", "price_minor", "price_unchanged", "free_plan", "reason", "price_ref"]);

interface BillingPlanPriceDeps {
  // requestId is the web request's x-request-id, forwarded to the database so the audit row names the request.
  userClient: (authorization: string, requestId?: string) => SupabaseClient;
  provider: Pick<BillingProvider, "name" | "createPrice">;
}

interface PriceChange {
  planCode: string;
  priceMinor: number;
  reason: string;
}

interface PlanPrice {
  price_minor: number;
  currency: string;
  interval: string;
  product_ref: string | null;
}

type DatabaseError = { code?: string; message?: string; details?: string | null };

function parse(body: unknown): PriceChange | { field: string } {
  if (!isObject(body)) {
    return { field: "body" };
  }
  const { plan_code: planCode, price_minor: priceMinor, reason } = body;
  if (typeof planCode !== "string" || planCode.length > MAX_PLAN_CODE || !PLAN_CODE.test(planCode)) {
    return { field: "plan_code" };
  }
  if (!Number.isInteger(priceMinor) || (priceMinor as number) < MIN_PRICE || (priceMinor as number) > MAX_PRICE) {
    return { field: "price_minor" };
  }
  const trimmed = typeof reason === "string" ? reason.replace(REASON_TRIM, "") : "";
  if (trimmed.length < MIN_REASON || trimmed.length > MAX_REASON) {
    return { field: "reason" };
  }
  return { planCode, priceMinor: priceMinor as number, reason: trimmed };
}

function refusal(error: DatabaseError): Response {
  const { code = "", message = "", details = null } = error;
  if (message === "CHARA_UNAUTHENTICATED" || message.startsWith("permission denied") || code.startsWith("PGRST30")) {
    return json(401, { error: "unauthorized" });
  }
  if (message === "CHARA_FORBIDDEN") {
    return json(403, { error: "forbidden", reason: details && REASONS.has(details) ? details : null });
  }
  if (message === "CHARA_UNAVAILABLE" && details === "plan_not_synced") {
    return json(409, { error: "conflict", reason: details });
  }
  if (message === "CHARA_INVALID_INPUT" || code === "22023") {
    return json(400, { error: "bad_request", field: details && FIELDS.has(details) ? details : null });
  }
  console.error("billing-plan-price failed", { code: code.slice(0, 16) });
  return json(502, { error: "unavailable" });
}

function planPrice(data: unknown): PlanPrice | null {
  const row = Array.isArray(data) && isObject(data[0]) ? data[0] : null;
  return row && typeof row.price_minor === "number" && typeof row.currency === "string" && row.interval === "month" &&
      (row.product_ref === null || typeof row.product_ref === "string")
    ? (row as unknown as PlanPrice)
    : null;
}

// A price change (FR-R2 AC8): the database says whether the caller may change prices, the provider creates the new price
// on the plan's product, and the database records it, both calls with the caller's token. Nothing here reads or writes
// a subscription: existing subscriptions keep their price until the provider moves them.
export async function handleBillingPlanPrice(req: Request, deps: BillingPlanPriceDeps): Promise<Response> {
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }
  const authorization = req.headers.get("authorization") ?? "";
  if (!signedInUser(authorization)) {
    return json(401, { error: "unauthorized" });
  }
  const request = parse(await req.json().catch(() => null));
  if ("field" in request) {
    return json(400, { error: "bad_request", field: request.field });
  }

  const requestId = req.headers.get("x-request-id") ?? "";
  const client = deps.userClient(authorization, UUID.test(requestId) ? requestId.toLowerCase() : undefined);
  const { data, error } = await client.rpc("admin_get_plan_price", { p_code: request.planCode });
  if (error) {
    return refusal(error);
  }
  const plan = planPrice(data);
  if (!plan) {
    return json(502, { error: "unavailable" });
  }
  if (plan.price_minor === 0) {
    return json(400, { error: "bad_request", field: "free_plan" });
  }
  if (plan.price_minor === request.priceMinor) {
    return json(400, { error: "bad_request", field: "price_unchanged" });
  }
  if (deps.provider.name === "stripe" && !plan.product_ref) {
    return json(409, { error: "conflict", reason: "plan_not_synced" });
  }

  let priceRef: string | null;
  try {
    ({ priceRef } = await deps.provider.createPrice({
      productRef: plan.product_ref,
      amountMinor: request.priceMinor,
      currency: plan.currency,
      interval: "month",
      metadata: { plan_code: request.planCode },
    }));
  } catch (e) {
    console.error("billing-plan-price provider failed", { code: errorCode(e) });
    return json(502, { error: "unavailable" });
  }

  const { error: recordError } = await client.rpc("admin_record_plan_price", {
    p_code: request.planCode,
    p_price_ref: priceRef,
    p_price_minor: request.priceMinor,
    p_reason: request.reason,
  });
  if (recordError) {
    // The provider holds a price that no plan uses; the operator archives it (docs/runbooks/checkout.md).
    console.error("billing-plan-price price not recorded", { plan: request.planCode, price: priceRef });
    return refusal(recordError);
  }
  return json(200, { plan_code: request.planCode, price_minor: request.priceMinor });
}
