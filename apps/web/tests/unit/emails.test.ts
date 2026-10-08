import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isNotificationKind, renderEmail, type NotificationKind } from "@/emails/index";
import { applicantsPath, applicationPath, billingPath, jobPath, settingsPath } from "@/lib/routes";

const SITE = "https://chara.example";
const APP = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";

const SAMPLES: Record<NotificationKind, Record<string, unknown>> = {
  application_received: { application_id: APP, job_id: JOB, job_title: "Welder MIG/MAG", org_slug: "acme-bau" },
  status_changed: { application_id: APP, job_id: JOB, job_title: "Welder MIG/MAG", status: "interview" },
  vacancy_hidden: { job_id: JOB, job_title: "Welder MIG/MAG", org_slug: "acme-bau", reasons: "The salary claim is misleading." },
  trial_ending: { org_slug: "acme-bau", trial_ends_at: "2026-11-01", plan_code: "employer_starter", amount_minor: 3900, currency: "EUR" },
  payment_failed: { org_slug: "acme-bau" },
  legal_version: { document_slug: "worker-terms", version: 3 },
  mfa_reset: {},
  deletion_requested: { erases_on: "2026-11-02T08:00:00+00:00" },
  deletion_completed: {},
  erasure_paused: { account_id: ACCOUNT },
};

const LEAKS = {
  cover_note: "SECRET-COVER-NOTE",
  note: "SECRET-STAGE-NOTE",
  decline_reason: "SECRET-DECLINE",
  document: "SECRET-DOCUMENT.pdf",
  password: "SECRET-PASSWORD",
  token: "SECRET-TOKEN",
  email: "secret@example.test",
};

const KINDS = Object.keys(SAMPLES) as NotificationKind[];

describe("notification templates", () => {
  it("cover every kind the database accepts, and only those", () => {
    const sql = readFileSync(new URL("../../../../supabase/migrations/20261030100000_transactional_emails.sql", import.meta.url), "utf8");
    const list = /kind text not null check \(kind in \(([^)]*)\)\)/.exec(sql)?.[1] ?? "";
    const accepted = [...list.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort();
    expect(accepted).toEqual([...KINDS].sort());
    for (const kind of KINDS) {
      expect(isNotificationKind(kind)).toBe(true);
    }
    expect(isNotificationKind("newsletter")).toBe(false);
    expect(isNotificationKind("constructor")).toBe(false);
    expect(isNotificationKind(undefined)).toBe(false);
  });

  it.each(KINDS)("%s renders an English page, a plain text version and a one-line subject", async (kind) => {
    const email = await renderEmail(kind, SAMPLES[kind], SITE);
    expect(email.html).toContain('lang="en"');
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject.length).toBeGreaterThan(5);
    expect(email.text.length).toBeGreaterThan(40);
    expect(email.text).not.toContain("<");
  });

  it.each(KINDS)("%s shows nothing that is not whitelisted", async (kind) => {
    const email = await renderEmail(kind, { ...SAMPLES[kind], ...LEAKS }, SITE);
    for (const secret of Object.values(LEAKS)) {
      expect(email.html).not.toContain(secret);
      expect(email.text).not.toContain(secret);
      expect(email.subject).not.toContain(secret);
    }
  });

  it.each(KINDS)("%s renders from an empty payload without failing", async (kind) => {
    const email = await renderEmail(kind, {}, SITE);
    expect(email.html).toContain('lang="en"');
    expect(email.html).not.toContain("undefined");
    expect(email.text).not.toContain("undefined");
  });

  it("link to the page concerned, with the paths of the web application", async () => {
    const links: Record<string, string> = {
      application_received: applicantsPath("en", "acme-bau"),
      status_changed: applicationPath("en", APP),
      vacancy_hidden: jobPath("en", "acme-bau", JOB),
      trial_ending: billingPath("en", "acme-bau"),
      payment_failed: billingPath("en", "acme-bau"),
      legal_version: "/en/legal/worker-terms",
      mfa_reset: "/en/login",
      deletion_requested: settingsPath("en"),
    };
    for (const [kind, path] of Object.entries(links)) {
      const email = await renderEmail(kind as NotificationKind, SAMPLES[kind as NotificationKind], SITE);
      expect(email.html, kind).toContain(`href="${SITE}${path}"`);
      expect(email.text, kind).toContain(`${SITE}${path}`);
    }
  });

  it("link without a double slash when the site address ends with one", async () => {
    const email = await renderEmail("payment_failed", SAMPLES.payment_failed, `${SITE}/`);
    expect(email.html).toContain(`href="${SITE}/en/org/acme-bau/billing"`);
  });

  it("status_changed names the new state with the label of the application", async () => {
    const expected: Record<string, string> = {
      shortlisted: "Shortlisted",
      interview: "Interview",
      offer: "Offer",
      hired: "Hired",
      rejected: "Not selected",
    };
    for (const [status, label] of Object.entries(expected)) {
      const email = await renderEmail("status_changed", { ...SAMPLES.status_changed, status }, SITE);
      expect(email.text).toContain(`is now: ${label}.`);
      expect(email.text).toContain("Welder MIG/MAG");
    }
    const withdrawn = await renderEmail("status_changed", { ...SAMPLES.status_changed, status: "withdrawn" }, SITE);
    expect(withdrawn.text).toContain("You withdrew your application for Welder MIG/MAG.");
    const unknown = await renderEmail("status_changed", { ...SAMPLES.status_changed, status: "<script>" }, SITE);
    expect(unknown.html).not.toContain("<script>");
    expect(unknown.text).toContain("There is an update on your application");
  });

  it("vacancy_hidden shows the title, the statement of reasons and the appeal route, and no applicant", async () => {
    const email = await renderEmail("vacancy_hidden", SAMPLES.vacancy_hidden, SITE);
    expect(email.subject).toBe('Your vacancy "Welder MIG/MAG" was hidden');
    expect(email.text).toContain("The salary claim is misleading.");
    expect(email.text).toContain(`${SITE}/en/legal/complaints-and-dispute-process`);
    expect(email.text.toLowerCase()).not.toContain("applicant");
  });

  it("trial_ending shows the end date and the price after the trial", async () => {
    const email = await renderEmail("trial_ending", SAMPLES.trial_ending, SITE);
    expect(email.subject).toBe("Your CHARA trial ends on 2026-11-01");
    expect(email.text).toContain("ends on 2026-11-01");
    expect(email.text).toContain("Employer starter");
    expect(email.text).toContain("€39.00");
    const yen = await renderEmail("trial_ending", { ...SAMPLES.trial_ending, amount_minor: 5000, currency: "JPY" }, SITE);
    expect(yen.text).toContain("¥5,000");
    const noPrice = await renderEmail("trial_ending", { ...SAMPLES.trial_ending, currency: "euro" }, SITE);
    expect(noPrice.text).not.toContain("costs");
  });

  it("deletion_requested shows the date of the erasure", async () => {
    const email = await renderEmail("deletion_requested", SAMPLES.deletion_requested, SITE);
    expect(email.text).toContain("erased on 2026-11-02");
    const none = await renderEmail("deletion_requested", { erases_on: "soon" }, SITE);
    expect(none.text).not.toContain("erased on");
  });

  it("keep the subject on one line when a value holds a line break", async () => {
    const email = await renderEmail("application_received", { ...SAMPLES.application_received, job_title: "Welder\r\nBcc: x@example.test" }, SITE);
    expect(email.subject).toBe("New application for Welder Bcc: x@example.test");
  });

  it("escape markup in the values they show", async () => {
    const email = await renderEmail("vacancy_hidden", { ...SAMPLES.vacancy_hidden, reasons: "<img src=x onerror=alert(1)>" }, SITE);
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&lt;img src=x");
  });
});
