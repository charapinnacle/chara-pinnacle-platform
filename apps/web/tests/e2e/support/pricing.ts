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

// The seeded values of what the tests change (supabase/seeds/ref/plans.sql).
export function restorePlans(): void {
  execute(`
    update billing.plans set name = 'Basic', price_minor = 3900, trial_days = 30, is_public = true where code = 'employer_starter';
    update billing.plans set name = 'Professional', price_minor = 7900, trial_days = 30, is_public = true where code = 'employer_professional';
    update billing.plans set is_public = false, contact_sales = true, price_minor = 0 where code = 'employer_enterprise';
    delete from billing.plan_features where feature_key in ('chara_match', 'corridors', 'advanced_worker_search');
    delete from billing.plan_limits where limit_key = 'active_requirements';
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
