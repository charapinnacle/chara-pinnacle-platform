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

// The Edge Function processes of supabase/functions/serve-local.sh and the tests that call them read these values from
// the environment: they are defined here once (webServer processes and workers inherit them).
process.env.ACCOUNT_OPS_PORT ||= "54430";
process.env.SCAN_DOCUMENT_PORT ||= "54431";
process.env.DOCUMENT_URL_PORT ||= "54432";
process.env.NOTIFY_PORT ||= "54433";
process.env.BILLING_CHECKOUT_PORT ||= "54434";
process.env.BILLING_WEBHOOK_PORT ||= "54435";
process.env.EDGE_SHARED_SECRET ||= "local-scheduler-secret";
// Signs the deliveries that tests send to billing-webhook (the null billing provider).
process.env.BILLING_WEBHOOK_SECRET ||= "local-billing-webhook-secret";
// Signs the delivery events that tests send to notify, as Resend would (whsec_ and the base64 of the key).
process.env.RESEND_WEBHOOK_SECRET ||= "whsec_bG9jYWwtcmVzZW5kLXdlYmhvb2stc2VjcmV0LTAxMjM0NQ==";
process.env.DOCUMENT_URL_ENDPOINT ||= `http://127.0.0.1:${process.env.DOCUMENT_URL_PORT}/`;
process.env.BILLING_CHECKOUT_ENDPOINT ||= `http://127.0.0.1:${process.env.BILLING_CHECKOUT_PORT}/`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  // The CI runner is slower than a development machine and runs the tests in parallel: the 5 s default is too tight
  // for flows that cross several requests (upload, invitations, skeleton states).
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: { baseURL, trace: "retain-on-failure" },
  // Tests that publish legal versions cannot share a run with the others: they follow the main project.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [
        "**/consent-versions.spec.ts",
        "**/account-ops.spec.ts",
        "**/account-erasure.spec.ts",
        "**/team-limits.spec.ts",
        "**/vacancy-limits.spec.ts",
        "**/shortlisting.spec.ts",
        "**/public-search-failure.spec.ts",
        "**/vacancy-page-failure.spec.ts",
        "**/saved-vacancies-failure.spec.ts",
        "**/apply-failure.spec.ts",
        "**/applicant-list-failure.spec.ts",
        "**/dashboard-failure.spec.ts",
        "**/notify-emails.spec.ts",
        "**/admin-console-jobs.spec.ts",
        "**/admin-console-staff-database.spec.ts",
        "**/member-invitation-email.spec.ts",
        "**/checkout-disclosure.spec.ts",
        "**/public-pages-failure.spec.ts",
        "**/pricing.spec.ts",
      ],
    },
    {
      name: "versions",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/consent-versions.spec.ts",
      dependencies: ["chromium"],
    },
    // account-ops takes every job in the queue, so these tests must not overlap the ones that count queued jobs, and
    // the two specs that run it follow one another as projects: in one project their files would run side by side.
    {
      name: "account-ops",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/account-ops.spec.ts",
      dependencies: ["chromium", "versions"],
    },
    {
      name: "account-erasure",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/account-erasure.spec.ts",
      dependencies: ["account-ops"],
    },
    // The plan limits are switched on for the whole database while these specs run: a vacancy published by any other
    // spec in that time would meet a limit of its organization, so they follow every other project, one after the
    // other (each puts the setting back when it ends).
    {
      name: "limits-team",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/team-limits.spec.ts",
      dependencies: ["chromium", "versions", "account-ops", "account-erasure"],
    },
    {
      name: "limits-vacancies",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/vacancy-limits.spec.ts",
      dependencies: ["limits-team"],
    },
    {
      name: "limits-shortlisting",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/shortlisting.spec.ts",
      dependencies: ["limits-vacancies"],
    },
    // The search and vacancy page functions are withdrawn from the API roles while these specs run, so they follow every
    // other project (one file after the other: the files of a project run side by side).
    {
      name: "search-failure",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/public-search-failure.spec.ts",
      dependencies: ["limits-shortlisting"],
    },
    {
      name: "vacancy-page-failure",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/vacancy-page-failure.spec.ts",
      dependencies: ["search-failure"],
    },
    // The saved list function and the insert privilege of saved_jobs are withdrawn from the API role while this spec runs.
    {
      name: "saved-failure",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/saved-vacancies-failure.spec.ts",
      dependencies: ["vacancy-page-failure"],
    },
    // The functions that apply, list and withdraw applications are withdrawn from the API role while this spec runs.
    {
      name: "apply-failure",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/apply-failure.spec.ts",
      dependencies: ["saved-failure"],
    },
    // The applications table is locked, and the applicants view withdrawn from the API role, while this spec runs.
    {
      name: "applicants-failure",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/applicant-list-failure.spec.ts",
      dependencies: ["apply-failure"],
    },
    // The applications table is locked, and the dashboard function withdrawn from the API role, while this spec runs.
    {
      name: "dashboard-failure",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/dashboard-failure.spec.ts",
      dependencies: ["applicants-failure"],
    },
    // notify takes every message in the queue and sends it to the mail catcher, so it runs after everything that counts
    // queued messages.
    {
      name: "notify",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/notify-emails.spec.ts",
      dependencies: ["dashboard-failure"],
    },
    // These run account-ops and notify as well, so they follow notify.
    {
      name: "admin-jobs",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/admin-console-jobs.spec.ts",
      dependencies: ["notify-invitation"],
    },
    // The staff function is withdrawn from the API role, a table of Auth is locked and the staff list is filled up while
    // this spec runs.
    {
      name: "staff-database",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/admin-console-staff-database.spec.ts",
      dependencies: ["admin-jobs"],
    },
    // The same reason: the file after the other, not beside it.
    {
      name: "notify-invitation",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/member-invitation-email.spec.ts",
      dependencies: ["notify"],
    },
    // The trial length of the Basic plan is changed for the whole database while this spec runs, so it follows every
    // other project.
    {
      name: "billing-plans",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/checkout-disclosure.spec.ts",
      dependencies: ["notify-invitation"],
    },
    // The price, the name and the trial length of the plans are changed for the whole database while this spec runs, and
    // the view of the plans is withdrawn from the API roles, so it follows the other spec that changes a plan.
    {
      name: "pricing-plans",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/pricing.spec.ts",
      dependencies: ["billing-plans"],
    },
    // The accessor of the public settings is withdrawn from the API roles while this spec runs, so it follows every
    // other project.
    {
      name: "public-pages-failure",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/public-pages-failure.spec.ts",
      dependencies: ["pricing-plans"],
    },
  ],
  // The second server runs the same build with Continue with Google switched on; the flag is read per request.
  webServer: [
    {
      command: `../../supabase/functions/serve-local.sh account-ops ${process.env.ACCOUNT_OPS_PORT}`,
      port: Number(process.env.ACCOUNT_OPS_PORT),
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `../../supabase/functions/serve-local.sh scan-document ${process.env.SCAN_DOCUMENT_PORT}`,
      port: Number(process.env.SCAN_DOCUMENT_PORT),
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `../../supabase/functions/serve-local.sh document-url ${process.env.DOCUMENT_URL_PORT}`,
      port: Number(process.env.DOCUMENT_URL_PORT),
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `../../supabase/functions/serve-local.sh notify ${process.env.NOTIFY_PORT}`,
      port: Number(process.env.NOTIFY_PORT),
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `../../supabase/functions/serve-local.sh billing-checkout ${process.env.BILLING_CHECKOUT_PORT}`,
      port: Number(process.env.BILLING_CHECKOUT_PORT),
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `../../supabase/functions/serve-local.sh billing-webhook ${process.env.BILLING_WEBHOOK_PORT}`,
      port: Number(process.env.BILLING_WEBHOOK_PORT),
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
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
