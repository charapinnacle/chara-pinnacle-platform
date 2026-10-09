import type { SubscriptionState } from "./provider.ts";

export type DifferenceKind = "missing_record" | "extra_record" | "status_mismatch" | "plan_mismatch";

export interface SubscriptionRecord {
  provider_subscription_ref: string;
  plan_code: string;
  status: string;
}

export interface Difference {
  kind: DifferenceKind;
  subscription_ref: string;
}

// The provider's subscriptions that are not canceled against the records of billing.subscriptions. A canceled record that
// the provider no longer lists is in agreement; a live record the provider does not list is extra.
export function compareSubscriptions(provider: SubscriptionState[], records: SubscriptionRecord[]): Difference[] {
  const byRef = new Map(records.map((record) => [record.provider_subscription_ref, record]));
  const listed = new Set(provider.map((state) => state.providerSubscriptionRef));
  const differences: Difference[] = [];
  for (const state of provider) {
    const record = byRef.get(state.providerSubscriptionRef);
    if (!record) {
      differences.push({ kind: "missing_record", subscription_ref: state.providerSubscriptionRef });
    } else if (record.status !== state.status) {
      differences.push({ kind: "status_mismatch", subscription_ref: state.providerSubscriptionRef });
    } else if (state.planCode !== record.plan_code) {
      differences.push({ kind: "plan_mismatch", subscription_ref: state.providerSubscriptionRef });
    }
  }
  for (const record of records) {
    if (record.status !== "canceled" && !listed.has(record.provider_subscription_ref)) {
      differences.push({ kind: "extra_record", subscription_ref: record.provider_subscription_ref });
    }
  }
  return differences;
}
