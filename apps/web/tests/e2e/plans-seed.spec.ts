import { readFileSync } from "node:fs";
import path from "node:path";
import { execute, query } from "./support/db";
import { expect, test } from "./support/test";

const seed = readFileSync(path.join(__dirname, "../../../../supabase/seeds/ref/plans.sql"), "utf8");

function planData() {
  const [row] = query<{ plans: string; limits: string; features: string; audits: number }>(
    `select
       (select md5(string_agg(p::text, '|' order by code)) from billing.plans p) as plans,
       (select md5(string_agg(l::text, '|' order by plan_code, limit_key)) from billing.plan_limits l) as limits,
       (select md5(string_agg(f::text, '|' order by plan_code, feature_key)) from billing.plan_features f) as features,
       (select count(*)::int from audit.log where action = 'billing.plan_changed') as audits`,
  );
  return row;
}

test("FR-G1 AC1: loading the plan seed a second time changes no plan, limit or feature and writes no audit row", () => {
  const before = planData();
  expect(query("select code from billing.plans")).toHaveLength(4);

  execute(seed);

  expect(planData()).toEqual(before);
  expect(query("select code from billing.plans")).toHaveLength(4);
});
