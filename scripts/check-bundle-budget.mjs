#!/usr/bin/env node
// Bundle budget gate (NFR-P1, audit finding OBS-01): fails when the first-load JavaScript of a key route, as the build
// writes it to apps/web/.next/diagnostics/route-bundle-stats.json (uncompressed bytes of every chunk the route loads
// first), is above its `firstLoadJsBytes` in apps/web/tests/perf-budget.json, or when a route of the budget is not in the
// build. The other budgets of the file are measured in the browser by apps/web/tests/e2e/perf-smoke.spec.ts.
// Usage: node scripts/check-bundle-budget.mjs <perf-budget.json> <route-bundle-stats.json>
import { readFileSync } from "node:fs";

const USAGE = "Usage: node scripts/check-bundle-budget.mjs <perf-budget.json> <route-bundle-stats.json>\n";

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    process.stderr.write(`Bundle budget check failed: ${file} is not a readable JSON file\n`);
    process.exit(2);
  }
}

const [budgetFile, statsFile] = process.argv.slice(2);
if (!budgetFile || !statsFile) {
  process.stderr.write(USAGE);
  process.exit(2);
}

const sizes = new Map(readJson(statsFile).map((entry) => [entry.route, entry.firstLoadUncompressedJsBytes]));
const failures = [];
for (const { route, firstLoadJsBytes } of readJson(budgetFile).routes) {
  const size = sizes.get(route);
  if (size === undefined) failures.push(`${route} is not in the build`);
  else if (size > firstLoadJsBytes) failures.push(`${route} loads ${size} bytes of JavaScript first, over its budget of ${firstLoadJsBytes}`);
  else process.stdout.write(`${route}: ${size} of ${firstLoadJsBytes} bytes\n`);
}

if (failures.length > 0) {
  process.stderr.write(`Bundle budget check failed:\n${failures.map((failure) => `- ${failure}\n`).join("")}`);
  process.exit(1);
}
