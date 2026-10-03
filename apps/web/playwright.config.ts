import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://localhost:3100";

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
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm run start",
    url: baseURL,
    timeout: 300_000,
    reuseExistingServer: false,
  },
});
