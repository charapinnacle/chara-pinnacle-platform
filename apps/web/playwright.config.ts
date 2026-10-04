import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://localhost:3100";
const googleBaseURL = "http://localhost:3101";

const envFile = path.join(__dirname, ".env.local");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

// The admin key is read at test time only: it never enters the Next.js build or
// any NEXT_PUBLIC variable. It comes from the local stack so that `npm run e2e`
// needs no setup; a non-empty exported E2E_AUTH_ADMIN_KEY wins.
function localAdminKey(): string {
  const status = execFileSync("npx", ["supabase", "status", "-o", "env"], {
    cwd: path.join(__dirname, "../.."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const match = /^SECRET_KEY="(.+)"$/m.exec(status);
  if (!match) {
    throw new Error(
      "The local Supabase stack is not running (npm run db:start)",
    );
  }
  return match[1];
}

process.env.E2E_AUTH_ADMIN_KEY ||= localAdminKey();

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: { baseURL, trace: "retain-on-failure" },
  // Tests that publish legal versions cannot share a run with the others: they follow the main project.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: ["**/consent-versions.spec.ts", "**/account-ops.spec.ts"],
    },
    {
      name: "versions",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/consent-versions.spec.ts",
      dependencies: ["chromium"],
    },
    // account-ops takes every job in the queue, so these tests must not overlap the ones that count queued jobs.
    {
      name: "account-ops",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/account-ops.spec.ts",
      dependencies: ["chromium", "versions"],
    },
  ],
  // The second server runs the same build with Continue with Google switched on; the flag is read per request.
  webServer: [
    {
      command: "../../supabase/functions/serve-local.sh",
      port: 54430,
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      command: "npm run build && npm run start",
      url: baseURL,
      timeout: 300_000,
      reuseExistingServer: false,
    },
    {
      command: "npx next start --port 3101",
      url: googleBaseURL,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { GOOGLE_SIGN_IN_ENABLED: "true" },
    },
  ],
});
