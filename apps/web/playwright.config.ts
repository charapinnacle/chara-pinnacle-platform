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
process.env.BILLING_PLAN_PRICE_PORT ||= "54436";
process.env.EDGE_SHARED_SECRET ||= "local-scheduler-secret";
// Signs the deliveries that tests send to billing-webhook (the null billing provider).
process.env.BILLING_WEBHOOK_SECRET ||= "local-billing-webhook-secret";
// Signs the delivery events that tests send to notify, as Resend would (whsec_ and the base64 of the key).
process.env.RESEND_WEBHOOK_SECRET ||= "whsec_bG9jYWwtcmVzZW5kLXdlYmhvb2stc2VjcmV0LTAxMjM0NQ==";
process.env.DOCUMENT_URL_ENDPOINT ||= `http://127.0.0.1:${process.env.DOCUMENT_URL_PORT}/`;
process.env.BILLING_CHECKOUT_ENDPOINT ||= `http://127.0.0.1:${process.env.BILLING_CHECKOUT_PORT}/`;
process.env.BILLING_PLAN_PRICE_ENDPOINT ||= `http://127.0.0.1:${process.env.BILLING_PLAN_PRICE_PORT}/`;

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
        "**/error-boundary.spec.ts",
        "**/notify-emails.spec.ts",
        "**/admin-console-jobs.spec.ts",
        "**/admin-console-staff-database.spec.ts",
        "**/member-invitation-email.spec.ts",
        "**/checkout-disclosure.spec.ts",
        "**/live-statistics.spec.ts",
        "**/public-pages-failure.spec.ts",
        "**/billing-page-failure.spec.ts",
        "**/pricing.spec.ts",
        "**/search-engine-sitemap.spec.ts",
        "**/perf-smoke.spec.ts",
        "**/in-app-notifications.spec.ts",
        "**/partner-legal-documents.spec.ts",
        "**/partner-registration.spec.ts",
        "**/partner-geographies.spec.ts",
        "**/partner-workforce-offer.spec.ts",
        "**/partner-commitment.spec.ts",
        "**/partner-submit-review.spec.ts",
        "**/partner-licences.spec.ts",
        "**/partner-approval.spec.ts",
        "**/partner-availability.spec.ts",
        "**/partner-usage-limits.spec.ts",
        "**/partner-review-emails.spec.ts",
        "**/partner-checkout.spec.ts",
        "**/plan-editor-release.spec.ts",
        "**/partner-profile.spec.ts",
        "**/partner-search.spec.ts",
        "**/staffing-directory.spec.ts",
        "**/company-page.spec.ts",
        "**/save-partner-follow.spec.ts",
        "**/partner-network-pages.spec.ts",
        "**/data-export.spec.ts",
        "**/partner-dashboards.spec.ts",
        "**/admin-network-statistics.spec.ts",
        "**/partner-team.spec.ts",
        "**/ranking-transparency.spec.ts",
        "**/release-2a-journey.spec.ts",
        "**/workforce-requirements.spec.ts",
        "**/requirement-limits.spec.ts",
        "**/requirement-vacancies.spec.ts",
        "**/partner-suggestions.spec.ts",
        "**/job-orders.spec.ts",
        "**/invitations.spec.ts",
        "**/requirement-changes.spec.ts",
        "**/partner-responses.spec.ts",
        "**/response-decisions.spec.ts",
        "**/candidate-submissions.spec.ts",
        "**/submission-pipeline.spec.ts",
        "**/commitment-reconsent.spec.ts",
        "**/find-employers.spec.ts",
        "**/job-order-company-page.spec.ts",
        "**/partner-dashboards-job-orders.spec.ts",
        "**/employer-network-dashboard.spec.ts",
        "**/messaging.spec.ts",
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
    // The limits function of the passport and the document function of the sign-up page are withdrawn from the API roles
    // while this spec runs.
    {
      name: "error-boundary",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/error-boundary.spec.ts",
      dependencies: ["dashboard-failure"],
    },
    // notify takes every message in the queue and sends it to the mail catcher, so it runs after everything that counts
    // queued messages.
    {
      name: "notify",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/notify-emails.spec.ts",
      dependencies: ["error-boundary"],
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
    // The snapshot of the home page statistics is replaced, the threshold changed and the grant on its view withdrawn
    // while this spec runs, so it follows every other project.
    {
      name: "statistics",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/live-statistics.spec.ts",
      dependencies: ["staff-database", "billing-plans", "public-pages-failure"],
    },
    // The jobs table is locked, and the usage function withdrawn from the API role, while this spec runs.
    {
      name: "billing-failure",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/billing-page-failure.spec.ts",
      dependencies: ["statistics"],
    },
    // The release switch of the in-app notifications is on for the whole database while this spec runs, which adds the
    // bell to every signed-in header, so it follows every other project.
    {
      name: "notifications-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/in-app-notifications.spec.ts",
      dependencies: ["billing-failure"],
    },
    // The same release switch is set for the partner legal pages (FR-S4), so this spec follows the one above.
    {
      name: "partner-legal-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-legal-documents.spec.ts",
      dependencies: ["notifications-release"],
    },
    // The same release switch is set for partner sign-up (FR-J1), which adds the partner choices to every sign-up form,
    // so this spec follows the one above.
    {
      name: "partner-registration-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-registration.spec.ts",
      dependencies: ["partner-legal-release"],
    },
    // The same release switch is set for Where you serve (FR-K1), so this spec follows the one above.
    {
      name: "partner-geographies-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-geographies.spec.ts",
      dependencies: ["partner-registration-release"],
    },
    // The same release switch is set for What you offer (FR-K2), so this spec follows the one above.
    {
      name: "partner-workforce-offer-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-workforce-offer.spec.ts",
      dependencies: ["partner-geographies-release"],
    },
    // The same release switch is set for the employer-pays commitment (FR-J3), whose spec also publishes a version of the
    // commitment for a while, so this spec follows the one above.
    {
      name: "partner-commitment-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-commitment.spec.ts",
      dependencies: ["partner-workforce-offer-release"],
    },
    // The same release switch is set for the submission for review (FR-J1), so this spec follows the one above.
    {
      name: "partner-submit-review-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-submit-review.spec.ts",
      dependencies: ["partner-commitment-release"],
    },
    // The same release switch is set for the licences (FR-J2), and one test withdraws the function that adds a licence,
    // so this spec follows the one above.
    {
      name: "partner-licences-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-licences.spec.ts",
      dependencies: ["partner-submit-review-release"],
    },
    // The same release switch is set for the partner reviews (FR-J4), and one test withdraws the decision function, so
    // this spec follows the one above.
    {
      name: "partner-approval-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-approval.spec.ts",
      dependencies: ["partner-licences-release"],
    },
    // The same release switch is set for the availability listings (FR-K3), and one test withdraws the update function,
    // so this spec follows the one above.
    {
      name: "partner-availability-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-availability.spec.ts",
      dependencies: ["partner-approval-release"],
    },
    // The same release switch is set for the partner usage and upgrade prompt (FR-R1), so this spec follows the one above.
    {
      name: "partner-usage-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-usage-limits.spec.ts",
      dependencies: ["partner-availability-release"],
    },
    // The same release switch is set for the partner notifications (FR-T1), whose spec also runs notify and the daily
    // licence and confirmation jobs over the whole database, so this spec follows the one above.
    {
      name: "partner-review-emails-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-review-emails.spec.ts",
      dependencies: ["partner-usage-release"],
    },
    // The same release switch is set for the partner pricing tabs and the partner checkout (FR-R1), so this spec follows
    // the one above.
    {
      name: "partner-checkout-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-checkout.spec.ts",
      dependencies: ["partner-review-emails-release"],
    },
    // The same release switch is turned on through the settings editor, and a partner plan is renamed for the whole
    // database (FR-R2), so this spec follows the one above.
    {
      name: "plan-editor-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/plan-editor-release.spec.ts",
      dependencies: ["partner-checkout-release"],
    },
    // The same release switch is set for the public partner profiles (FR-K4), and the profile read limit is lowered for a
    // moment, so this spec follows the one above.
    {
      name: "partner-profile-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-profile.spec.ts",
      dependencies: ["plan-editor-release"],
    },
    // The same release switch is set for the recruitment directory (FR-L1), the search function is withdrawn and the
    // search limit lowered for a moment, so this spec follows the one above.
    {
      name: "partner-search-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-search.spec.ts",
      dependencies: ["partner-profile-release"],
    },
    // The same release switch is set for the staffing directory and the available workforce search (FR-L2, FR-K3), the
    // two search functions are withdrawn, the search limit lowered and the entitlements enforced for a moment, so this
    // spec follows the one above.
    {
      name: "staffing-directory-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/staffing-directory.spec.ts",
      dependencies: ["partner-search-release"],
    },
    // The same release switch is set for the company pages (FR-K5) and the switch function is withdrawn for a moment, so
    // this spec follows the one above.
    {
      name: "company-page-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/company-page.spec.ts",
      dependencies: ["staffing-directory-release"],
    },
    // The same release switch is set for saved partners and follows (FR-L4), the save and list functions are withdrawn
    // for a moment and the follower digest runs over the whole database, so this spec follows the one above.
    {
      name: "save-partner-follow-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/save-partner-follow.spec.ts",
      dependencies: ["company-page-release"],
    },
    // The same release switch is set for the menu, sitemap and partner sections of the public pages, and the switches of
    // releases 2b and 2c too (FR-L5), so this spec follows the one above.
    {
      name: "partner-network-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-network-pages.spec.ts",
      dependencies: ["save-partner-follow-release"],
    },
    // The switch of the data export (FR-S3) is set for the whole database, release 2a for a moment, and the spec runs
    // account-ops, notify and the retention job over the whole database and withdraws the export functions for a moment,
    // so it follows the one above.
    {
      name: "data-export-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/data-export.spec.ts",
      dependencies: ["partner-network-release"],
    },
    // The partner dashboards (FR-R3, FR-R4) set release 2a for the whole database, lock a table and withdraw their
    // function for a moment, so they follow the one above.
    {
      name: "partner-dashboards-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-dashboards.spec.ts",
      dependencies: ["data-export-release"],
    },
    // The network statistics (FR-S2) set release 2a for the whole database and withdraw their count function for a
    // moment, so they follow the one above.
    {
      name: "admin-network-statistics-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/admin-network-statistics.spec.ts",
      dependencies: ["partner-dashboards-release"],
    },
    // The partner team pages (FR-J1) set release 2a for the whole database and enforce the limits for a moment, so they
    // follow the one above.
    {
      name: "partner-team-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-team.spec.ts",
      dependencies: ["admin-network-statistics-release"],
    },
    // The ranking page (NFR-C8) sets release 2a for the whole database, so it follows the one above.
    {
      name: "ranking-transparency-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/ranking-transparency.spec.ts",
      dependencies: ["partner-team-release"],
    },
    // The journey of release 2a from sign-up to the public profile (NFR-O4) sets release 2a for the whole database and
    // runs last of the release 2a projects.
    {
      name: "release-2a-journey",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/release-2a-journey.spec.ts",
      dependencies: ["ranking-transparency-release"],
    },
    // The workforce requirements (FR-M1) set release 2b for the whole database, so they follow the release 2a projects.
    {
      name: "workforce-requirements-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/workforce-requirements.spec.ts",
      dependencies: ["release-2a-journey"],
    },
    // The plan limits of workforce requirements (FR-M4) set release 2b and the entitlements for the whole database and
    // change an employer plan row for a moment, so they follow the workforce requirements.
    {
      name: "requirement-limits-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/requirement-limits.spec.ts",
      dependencies: ["workforce-requirements-release"],
    },
    // The vacancies from a workforce requirement (FR-M1 AC10) set release 2b and the entitlements for the whole database
    // and write draft vacancies, so they follow the requirement limits.
    {
      name: "requirement-vacancies-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/requirement-vacancies.spec.ts",
      dependencies: ["requirement-limits-release"],
    },
    // The partner suggestions (FR-M3) set releases 2a and 2b for the whole database and withdraw suggest_partners for a
    // moment, so they follow the vacancies from a requirement.
    {
      name: "partner-suggestions-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-suggestions.spec.ts",
      dependencies: ["requirement-vacancies-release"],
    },
    // The job order marketplace, the new job order alert and the public Job orders page (FR-N1, FR-L5) set releases 2a
    // and 2b for the whole database and withdraw list_job_orders for a moment, so they follow the partner suggestions.
    {
      name: "job-orders-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/job-orders.spec.ts",
      dependencies: ["partner-suggestions-release"],
    },
    // The invitation pages (FR-O1) set releases 2a and 2b and the plan limits for the whole database and withdraw
    // list_requirement_invitations for a moment, so they follow the job orders.
    {
      name: "invitations-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/invitations.spec.ts",
      dependencies: ["job-orders-release"],
    },
    // The requirement versions and the notices to invited partners (FR-M2, V43) set releases 2a and 2b for the whole
    // database and run the daily close and reminder jobs, so they follow the invitation pages.
    {
      name: "requirement-changes-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/requirement-changes.spec.ts",
      dependencies: ["invitations-release"],
    },
    // The response pages (FR-N2, FR-O2, V46) set releases 2a and 2b and the plan limits for the whole database and change
    // the documents limit and a direct-hiring rule while they run, so they follow the requirement changes.
    {
      name: "responses-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-responses.spec.ts",
      dependencies: ["requirement-changes-release"],
    },
    // The comparison and the decisions (FR-O3, V47) set releases 2a and 2b and the plan limits for the whole database and
    // withdraw compare_responses for a moment, so they follow the response pages.
    {
      name: "decisions-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/response-decisions.spec.ts",
      dependencies: ["responses-release"],
    },
    // The candidate submission pages (FR-O4, V49) set releases 2a and 2b, candidate submissions and the plan limits for
    // the whole database and withdraw list_partner_submissions for a moment, so they follow the decisions.
    {
      name: "submissions-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/candidate-submissions.spec.ts",
      dependencies: ["decisions-release"],
    },
    // The submission pipeline (FR-O5, V50) sets releases 2a and 2b and candidate submissions for the whole database and
    // withdraws list_employer_submissions for a moment, so it follows the submission pages.
    {
      name: "pipeline-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/submission-pipeline.spec.ts",
      dependencies: ["submissions-release"],
    },
    // The outdated employer-pays commitment (V52) publishes a version of the commitment, which blocks the responses and
    // submissions of every partner of the database for a while, and sets releases 2a and 2b and candidate submissions, so
    // it follows the pipeline.
    {
      name: "commitment-reconsent-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/commitment-reconsent.spec.ts",
      dependencies: ["pipeline-release"],
    },
    // Find Employers (FR-L3, V53) sets releases 2a and 2b for the whole database and withdraws search_employers for a
    // moment, so it follows the outdated commitment.
    {
      name: "find-employers-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/find-employers.spec.ts",
      dependencies: ["commitment-reconsent-release"],
    },
    // Named job orders on the company page (V54) set releases 2a and 2b for the whole database, so they follow Find
    // Employers.
    {
      name: "job-order-company-page-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/job-order-company-page.spec.ts",
      dependencies: ["find-employers-release"],
    },
    // The release 2b blocks of the partner dashboards (V55) set releases 2a and 2b for the whole database, so they follow
    // the named job orders.
    {
      name: "partner-dashboards-job-orders-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/partner-dashboards-job-orders.spec.ts",
      dependencies: ["job-order-company-page-release"],
    },
    // The partner network part of the employer dashboard (V56) sets releases 2a and 2b for the whole database, so it
    // follows the partner dashboards.
    {
      name: "employer-network-dashboard-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/employer-network-dashboard.spec.ts",
      dependencies: ["partner-dashboards-job-orders-release"],
    },
    // The messaging pages (V65) set releases 2a, 2b and 2c for the whole database, so they follow the employer network
    // dashboard.
    {
      name: "messaging-release",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/messaging.spec.ts",
      dependencies: ["employer-network-dashboard-release"],
    },
    // The sitemap is compared with every public vacancy of the database, so no other spec may open or close one while
    // these tests run: they follow every other project.
    {
      name: "sitemap",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/search-engine-sitemap.spec.ts",
      dependencies: ["messaging-release"],
    },
    // The load times of the performance smoke are measured when no other spec loads the server: last of all.
    {
      name: "perf",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/perf-smoke.spec.ts",
      dependencies: ["sitemap"],
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
      command: `../../supabase/functions/serve-local.sh billing-plan-price ${process.env.BILLING_PLAN_PRICE_PORT}`,
      port: Number(process.env.BILLING_PLAN_PRICE_PORT),
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
