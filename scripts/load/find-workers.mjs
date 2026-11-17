#!/usr/bin/env node
// Load test of Find Workers at 100,000 visible profiles (NFR-P3, V80; docs/perf/release-2c.md). In one transaction that
// is rolled back it seeds the passports of supabase/tests/database/find_workers_load_fixture.inc (100,000 listed cards
// among 110,000, two employers searching), runs the calls of the Find Workers page once untimed (warm-up) and then
// --runs times each (50 by default), prints the 50th and 95th percentile and the slowest server time of each, and with
// --plans the EXPLAIN ANALYZE plans of the main statements of each call (auto_explain, nested statements). It exits 1
// when a call is over the database budget at the 95th percentile: 200 ms, the share of the 500 ms NFR-P3 target left
// after the page's other reads and its render. The light version runs in CI as pgTAP 220_find_workers_load.
// Usage: node scripts/load/find-workers.mjs [--runs N] [--plans]. It runs psql in the local stack's database container;
// with DATABASE_URL set it runs the local psql against that database instead (a staging copy, never production: the
// seed switches the triggers of the passport lists off and locks those tables until it is rolled back).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BUDGET_MS = 200;
const CONTAINER = "supabase_db_chara-pinnacle";
const fixture = readFileSync(
  fileURLToPath(new URL("../../supabase/tests/database/find_workers_load_fixture.inc", import.meta.url)),
  "utf8",
);
// The statements worth a plan: the cards the keyword and the skills point to, the search itself, and the reads of the
// requests and the saved cards. The checks before them (settings, rate limit, the organisation's plan) are left out.
const MAIN_QUERY =
  /^Query Text: (v_q_headline :=|v_q_skill :=|select coalesce\(array_agg\(h\.worker_user_id\)|with found as \(|select s\.card_id, s\.requirement_id|select w\.card_id, l\.id)/m;

const args = process.argv.slice(2);
const runsAt = args.indexOf("--runs");
const runs = runsAt === -1 ? 50 : Number(args[runsAt + 1]);
const plans = args.includes("--plans");
if (!Number.isInteger(runs) || runs < 1 || runs > 1000) {
  process.stderr.write("Usage: node scripts/load/find-workers.mjs [--runs N] [--plans]\n");
  process.exit(2);
}

// Each case once more with auto_explain on, after a marker in the log, so its plans can be told apart.
const explain = `
set auto_explain.log_min_duration = 0;
set auto_explain.log_analyze = on;
set auto_explain.log_buffers = on;
set auto_explain.log_nested_statements = on;
set client_min_messages = log;
select format('do $m$ begin raise log %L; end $m$', '=== ' || label),
  'delete from private.rate_limit_hits',
  format('select pg_temp.workers_act_as(%L)', caller),
  format('select count(*) from (%s) r', sql),
  'reset role'
from load_cases order by position \\gexec
`;

const sql = `
\\set ON_ERROR_STOP 1
begin;
update private.settings set value = 'true' where key = 'release_find_workers';
${fixture}
select pg_temp.seed_find_workers(100000, 10000);
select pg_temp.prepare_find_workers_cases();
select pg_temp.run_find_workers_load(${runs});
\\echo === results
select jsonb_agg(to_jsonb(r) order by c.position) from load_results r join load_cases c using (label);
${plans ? explain : ""}
rollback;
`;

const command = process.env.DATABASE_URL
  ? ["psql", [process.env.DATABASE_URL, "-qAt", "-f", "-"]]
  : ["docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-qAt", "-f", "-"]];
const result = spawnSync(command[0], command[1], { input: sql, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
if (result.status !== 0) {
  process.stderr.write(result.stderr || "psql failed\n");
  process.exit(2);
}

const sections = result.stdout.split(/^=== /m);
const results = JSON.parse(sections.find((part) => part.startsWith("results"))?.split("\n")[1] ?? "null");
if (!Array.isArray(results)) {
  process.stderr.write("The load test returned no results\n");
  process.exit(2);
}

process.stdout.write(`Find Workers at 100,000 visible profiles, ${runs} runs per call (server time in the database)\n\n`);
process.stdout.write("| Call | Rows | p50 ms | p95 ms | max ms |\n|---|---|---|---|---|\n");
for (const row of results) {
  process.stdout.write(`| ${row.label} | ${row.rows_returned} | ${row.p50_ms} | ${row.p95_ms} | ${row.max_ms} |\n`);
}

if (plans) {
  // psql writes the auto_explain lines to stderr, each case after its marker; the query text is left out of the plan.
  const byCase = new Map();
  let current = null;
  for (const entry of result.stderr.split(/^(?:psql:[^\n]*?:\d+: )?LOG: {2}/m)) {
    const marker = /^=== (.+)$/m.exec(entry);
    if (marker && !entry.includes("plan:")) current = marker[1].trim();
    else if (current && MAIN_QUERY.test(entry)) {
      // The card ids a keyword or the skills point to are constants of the plan, thousands of them: only their number is kept.
      const plan = entry
        .replace(/^Query Text: [\s\S]*?\n(?=[A-Z][^\n]*? {2}\(cost=)/m, "")
        .replace(/'(\{[^']{200,}\})'/g, (_, list) => `'{${list.split(",").length} values}'`)
        .trim();
      byCase.set(current, [...(byCase.get(current) ?? []), plan]);
    }
  }
  for (const row of results) {
    const found = byCase.get(row.label) ?? ["(no plan captured)"];
    process.stdout.write(`\n### ${row.label}\n\n${found.map((plan) => `\`\`\`\n${plan}\n\`\`\`\n`).join("\n")}`);
  }
}

const over = results.filter((row) => Number(row.p95_ms) >= BUDGET_MS);
if (over.length > 0) {
  process.stderr.write(
    over.map((row) => `NFR-P3 load check failed: ${row.label} took ${row.p95_ms} ms at the 95th percentile (budget ${BUDGET_MS} ms)\n`).join(""),
  );
  process.exit(1);
}
process.stdout.write(`\nNFR-P3 load check passed: every call is within ${BUDGET_MS} ms at the 95th percentile\n`);
