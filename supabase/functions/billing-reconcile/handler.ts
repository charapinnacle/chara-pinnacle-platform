import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSharedSecret } from "../_shared/auth.ts";
import { json } from "../_shared/http.ts";
import {
  type BillingProvider,
  BillingProviderError,
  errorCode,
  type SubscriptionState,
} from "../_shared/billing/provider.ts";
import { compareSubscriptions, type SubscriptionRecord } from "../_shared/billing/reconcile.ts";

const RECORD_PAGE_SIZE = 1000;
// 50,000 subscriptions at 100 a page: a provider that never ends its list is a fault, not a long list.
const MAX_PAGES = 500;

interface BillingReconcileDeps {
  client: SupabaseClient;
  provider: BillingProvider;
  sharedSecret: string;
  alert: (alert: string, detail: Record<string, unknown>) => void;
}

interface RecordRow extends SubscriptionRecord {
  id: string;
}

async function providerSubscriptions(provider: BillingProvider): Promise<SubscriptionState[]> {
  const all: SubscriptionState[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { subscriptions, next } = await provider.listSubscriptions(after);
    all.push(...subscriptions);
    if (!next) {
      return all;
    }
    after = next;
  }
  throw new BillingProviderError("provider_list_too_long");
}

async function records(client: SupabaseClient, provider: string): Promise<SubscriptionRecord[]> {
  const all: RecordRow[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await client.rpc("billing_reconcile_records", {
      p_provider: provider,
      p_after: after,
      p_limit: RECORD_PAGE_SIZE,
    });
    if (error) {
      throw error;
    }
    const rows = data as RecordRow[];
    all.push(...rows);
    if (rows.length < RECORD_PAGE_SIZE) {
      return all;
    }
    after = rows[rows.length - 1].id;
  }
  throw new BillingProviderError("records_too_long");
}

// Weekly (pg_cron through pg_net): the subscriptions the provider holds against the records. The database raises one
// operations alert per difference and writes one audit row for the run. The null provider has no remote state, so
// there is nothing to compare.
export async function handleBillingReconcile(req: Request, deps: BillingReconcileDeps): Promise<Response> {
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }
  if (!hasSharedSecret(req, deps.sharedSecret)) {
    return json(401, { error: "unauthorized" });
  }
  if (deps.provider.name !== "stripe") {
    return json(200, { status: "skipped" });
  }
  try {
    const [held, stored] = await Promise.all([
      providerSubscriptions(deps.provider),
      records(deps.client, deps.provider.name),
    ]);
    const differences = compareSubscriptions(held, stored);
    const { error } = await deps.client.rpc("billing_reconcile_report", {
      p_provider: deps.provider.name,
      p_checked: held.length,
      p_differences: differences,
    });
    if (error) {
      throw error;
    }
    return json(200, { status: "compared", checked: held.length, differences: differences.length });
  } catch (e) {
    deps.alert("billing_reconcile_failed", { code: errorCode(e) });
    return json(500, { error: "reconcile_failed" });
  }
}
