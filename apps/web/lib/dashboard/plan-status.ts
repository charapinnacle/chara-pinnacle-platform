const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// The trial-ending alert shows in the last 72 hours of a trial (FR-E5).
const TRIAL_ALERT_HOURS = 72;

// The payment grace period starts at past_due_since (ARCHITECTURE.md section 10.1).
const GRACE_DAYS = 7;

export const planStatuses = ["trialing", "active", "past_due", "free"] as const;
export type PlanStatus = (typeof planStatuses)[number];

export const planStatusLabels: Record<PlanStatus, string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Past due",
  free: "Free plan",
};

// Whole days until the end, rounded up, never negative: a trial that ends in a minute has 1 day left.
export function daysLeft(end: Date, now: Date): number {
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));
}

// A subscription the provider cancelled reads as free on the dashboard, so "canceled" is a status the rule is also asked about.
export function trialAlert(status: PlanStatus | "canceled", trialEndsAt: Date | null, now: Date): { alert: boolean; daysLeft: number } {
  if (status !== "trialing" || !trialEndsAt) return { alert: false, daysLeft: 0 };
  const remaining = trialEndsAt.getTime() - now.getTime();
  return { alert: remaining > 0 && remaining <= TRIAL_ALERT_HOURS * HOUR_MS, daysLeft: daysLeft(trialEndsAt, now) };
}

export function graceEnd(pastDueSince: Date): Date {
  return new Date(pastDueSince.getTime() + GRACE_DAYS * DAY_MS);
}

export function daysLeftText(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"} left`;
}
