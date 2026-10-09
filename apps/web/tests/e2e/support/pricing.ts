import type { Locator, Page } from "@playwright/test";
import { execute, literal, query } from "./db";

export interface PlanRecord {
  code: string;
  name: string;
  price_minor: number;
  currency: string;
  interval: string;
  trial_days: number;
}

export function publicPlanRecords(): PlanRecord[] {
  return query<PlanRecord>(
    `select code, name, price_minor, currency, interval, trial_days from billing.plans
     where is_public and org_type = 'employer' order by sort`,
  );
}

export function setPlan(code: string, assignments: string): void {
  execute(`update billing.plans set ${assignments} where code = ${literal(code)}`);
}

const PLAN_TABLES = ["plans", "plan_limits", "plan_features"] as const;
let snapshot: Record<(typeof PLAN_TABLES)[number], string> | null = null;

// The plan records as they are when the file starts, so that what the tests change is put back to whatever the seed
// and the migrations left, not to values copied into the tests.
export function snapshotPlans(): void {
  snapshot = Object.fromEntries(
    PLAN_TABLES.map((table) => [table, execute(`select coalesce(json_agg(t), '[]') from billing.${table} t`).trim()]),
  ) as NonNullable<typeof snapshot>;
}

export function restorePlans(): void {
  const saved = snapshot;
  if (!saved) throw new Error("snapshotPlans() has not run");
  const rows = (table: (typeof PLAN_TABLES)[number]) => `json_populate_recordset(null::billing.${table}, ${literal(saved[table])}::json)`;
  execute(`
    insert into billing.plans select * from ${rows("plans")}
      on conflict (code) do update set org_type = excluded.org_type, name = excluded.name, price_minor = excluded.price_minor,
        currency = excluded.currency, interval = excluded.interval, trial_days = excluded.trial_days, is_public = excluded.is_public,
        is_default_trial = excluded.is_default_trial, contact_sales = excluded.contact_sales, sort = excluded.sort;
    delete from billing.plan_limits;
    insert into billing.plan_limits select * from ${rows("plan_limits")};
    delete from billing.plan_features;
    insert into billing.plan_features select * from ${rows("plan_features")};
    grant select on public.v_plans to anon, authenticated;
  `);
}

export function priceText(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

export function planCards(page: Page): Locator {
  return page.getByRole("list", { name: "Employer plans" }).locator(":scope > li");
}

export function planCard(page: Page, name: string): Locator {
  return planCards(page).filter({ has: page.getByRole("heading", { name, exact: true }) });
}

export function workersSection(page: Page): Locator {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Workers", level: 2 }) });
}
