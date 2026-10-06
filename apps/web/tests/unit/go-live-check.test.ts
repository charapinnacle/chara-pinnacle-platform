import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../../scripts/check-go-live.mjs", import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), "go-live-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(exported: string | null) {
  const args = [script];
  if (exported !== null) {
    const file = path.join(dir, "settings.json");
    writeFileSync(file, exported);
    args.push(file);
  }
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

describe("the go-live gate for plan limits (FR-C6 AC12)", () => {
  it.each([
    ["false", '{"entitlements_enforced": false}', "false"],
    ["missing", '{"audit_retention_years": 6}', "missing"],
    ["an empty export", "{}", "missing"],
    ['a string that is not "true"', '{"entitlements_enforced": "false"}', '"false"'],
  ])("fails and names the setting when entitlements_enforced is %s", (_, exported, found) => {
    const result = run(exported);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("entitlements_enforced");
    expect(result.stderr).toContain(`found: ${found}`);
  });

  it.each([
    ["jsonb true", '{"entitlements_enforced": true}'],
    ['jsonb "true"', '{"entitlements_enforced": "true"}'],
  ])("passes when entitlements_enforced is %s", (_, exported) => {
    const result = run(exported);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("fails with a usage error when no file is given and when the file is not JSON", () => {
    const none = run(null);
    expect(none.status).toBe(2);
    expect(none.stderr).toContain("Usage");
    const broken = run("not json");
    expect(broken.status).toBe(2);
    expect(broken.stderr).toContain("not a readable JSON export");
  });
});
