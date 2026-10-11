import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import budget from "../perf-budget.json";

const script = fileURLToPath(new URL("../../../../scripts/check-bundle-budget.mjs", import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), "bundle-budget-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const BUDGET = {
  routes: [
    { route: "/[lang]", as: "visitor", firstLoadJsBytes: 600000, transferredJsBytes: 1, serverMs: 1, loadMs: 1 },
    { route: "/[lang]/jobs", as: "visitor", firstLoadJsBytes: 800000, transferredJsBytes: 1, serverMs: 1, loadMs: 1 },
  ],
};

const stats = (home: number, jobs: number | null) =>
  [
    { route: "/[lang]", firstLoadUncompressedJsBytes: home, firstLoadChunkPaths: [] },
    ...(jobs === null ? [] : [{ route: "/[lang]/jobs", firstLoadUncompressedJsBytes: jobs, firstLoadChunkPaths: [] }]),
    { route: "/[lang]/about", firstLoadUncompressedJsBytes: 9_999_999, firstLoadChunkPaths: [] },
  ];

function run(statsContent: unknown, budgetContent: unknown = BUDGET) {
  const budgetFile = path.join(dir, "budget.json");
  const statsFile = path.join(dir, "stats.json");
  writeFileSync(budgetFile, typeof budgetContent === "string" ? budgetContent : JSON.stringify(budgetContent));
  writeFileSync(statsFile, typeof statsContent === "string" ? statsContent : JSON.stringify(statsContent));
  return spawnSync(process.execPath, [script, budgetFile, statsFile], { encoding: "utf8" });
}

describe("bundle budget gate (NFR-P1, OBS-01)", () => {
  it("passes and lists each route when every first load is within its budget, a route at the budget included", () => {
    const result = run(stats(600000, 790000));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("/[lang]: 600000 of 600000 bytes\n/[lang]/jobs: 790000 of 800000 bytes\n");
  });

  it("fails and names the route that is one byte over, and only that one", () => {
    const result = run(stats(600001, 790000));
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "Bundle budget check failed:\n- /[lang] loads 600001 bytes of JavaScript first, over its budget of 600000\n",
    );
  });

  it("fails when a route of the budget is missing from the build, so a renamed route cannot pass unchecked", () => {
    const result = run(stats(500000, null));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("- /[lang]/jobs is not in the build");
  });

  it("refuses a missing argument and an unreadable file with exit code 2", () => {
    expect(spawnSync(process.execPath, [script], { encoding: "utf8" }).status).toBe(2);
    const result = run("not json");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("is not a readable JSON file");
  });

  it("the committed budget has six routes, each with a viewer and four positive limits", () => {
    expect(budget.routes).toHaveLength(6);
    expect(new Set(budget.routes.map(({ route }) => route)).size).toBe(6);
    for (const { as, firstLoadJsBytes, transferredJsBytes, serverMs, loadMs } of budget.routes) {
      expect(["visitor", "candidate", "member"]).toContain(as);
      for (const limit of [firstLoadJsBytes, transferredJsBytes, serverMs, loadMs]) expect(limit).toBeGreaterThan(0);
    }
  });
});
