import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isNotificationKind, renderEmail, type NotificationKind } from "@/emails/index";
import { BRAND_NAME } from "@/lib/brand";
import {
  appealPath,
  applicantPath,
  applicantsPath,
  applicationPath,
  billingPath,
  dataExportPath,
  findWorkersCardPath,
  invitationPath,
  jobOrderPath,
  jobPath,
  requirementPath,
  requirementResponsesPath,
  requirementSubmissionsPath,
  responsePath,
  settingsPath,
  signUpPath,
  submissionPath,
} from "@/lib/routes";

const SITE = "https://chara.example";
const APP = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE";

const SAMPLES: Record<NotificationKind, Record<string, unknown>> = {
  application_received: { application_id: APP, job_title: "Welder MIG/MAG", org_name: "Acme Bau", org_slug: "acme-bau" },
  status_changed: { application_id: APP, job_title: "Welder MIG/MAG", org_name: "Acme Bau", status: "interview" },
  vacancy_hidden: { job_id: JOB, job_title: "Welder MIG/MAG", org_slug: "acme-bau", reasons: "The salary claim is misleading." },
  trial_ending: { org_slug: "acme-bau", trial_ends_at: "2026-11-01", plan_code: "employer_starter", amount_minor: 3900, currency: "EUR" },
  payment_failed: { org_slug: "acme-bau" },
  legal_version: { document_slug: "worker-terms", version: 3, change_summary: "Adds retention periods for application data." },
  mfa_reset: {},
  deletion_requested: { erases_on: "2026-11-02T08:00:00+00:00" },
  deletion_completed: {},
  erasure_paused: { account_id: ACCOUNT },
  account_suspended: { reasons: "Repeated fake profile reports." },
  account_reinstated: { reasons: "Identity confirmed after the complaint." },
  member_invitation: { org_name: "Acme Bau", role: "member", expires_at: "2026-10-15T09:30:00+00:00", token: TOKEN, invitation_id: ACCOUNT },
  account_exists: {},
  partner_approved: { decision_id: 41, org_name: "Manila Recruit", org_slug: "manila-recruit", decided_at: "2026-11-26T09:00:00+00:00" },
  partner_info_requested: {
    decision_id: 42,
    org_name: "Manila Recruit",
    org_slug: "manila-recruit",
    decided_at: "2026-11-26T09:00:00+00:00",
    info_step: "where_you_serve",
    reason: "Please add the countries you recruit for.",
  },
  partner_declined: {
    decision_id: 43,
    org_name: "Manila Recruit",
    org_slug: "manila-recruit",
    decided_at: "2026-11-26T09:00:00+00:00",
    reason: "The website does not belong to the company named.",
  },
  licence_expiring: {
    licence_id: ACCOUNT,
    country_code: "PH",
    country_name: "Philippines",
    valid_until: "2026-12-26",
    org_name: "Manila Recruit",
    org_slug: "manila-recruit",
  },
  partner_licence_expired: {
    licence_id: ACCOUNT,
    country_code: "PH",
    country_name: "Philippines",
    valid_until: "2026-11-25",
    org_name: "Manila Recruit",
    org_slug: "manila-recruit",
  },
  listing_confirmation_due: {
    org_name: "Manila Recruit",
    org_slug: "manila-recruit",
    total: 2,
    stale_days: 60,
    listings: [
      { listing_id: APP, occupation: "Welders and flame cutters", country_name: "Philippines", confirmed_at: "2026-10-12T08:00:00+00:00" },
      { listing_id: JOB, occupation: "Sheet-metal workers", country_name: "Nepal", confirmed_at: "2026-10-27T08:00:00+00:00" },
    ],
  },
  followed_company_activity: {
    organization_id: ACCOUNT,
    org_name: "Acme Bau",
    org_slug: "acme-bau",
    total: 2,
    vacancies: [
      { job_id: JOB, job_title: "Welder MIG/MAG" },
      { job_id: APP, job_title: "Crane operator" },
    ],
  },
  moderation_decision: {
    target_type: "partner_profile",
    target_id: ACCOUNT,
    title: "Manila Recruit",
    org_slug: "manila-recruit",
    decision: "hide",
    reasons: "The profile claims placements that were never made.",
    moderation_action_id: 42,
  },
  data_export_ready: { export_id: ACCOUNT, expires_at: "2026-12-17T08:00:00+00:00" },
  requirement_closing_soon: { requirement_id: JOB, title: "Welders for Hamburg", closes_on: "2027-04-10", org_slug: "acme-bau" },
  job_order_match: {
    requirement_id: JOB,
    title: "Germany, 100 Welders and flame cutters",
    country_code: "DE",
    country_name: "Germany",
    org_slug: "manila-recruit",
  },
  invitation_received: {
    invitation_id: APP,
    title: "Hamburg yard welders",
    country_code: "DE",
    country_name: "Germany",
    workers_needed: 10,
    start_date: "2027-03-01",
    employer_name: "Acme Bau",
    org_slug: "manila-recruit",
  },
  invitation_withdrawn: { invitation_id: APP, title: "Hamburg yard welders", employer_name: "Acme Bau", org_slug: "manila-recruit" },
  requirement_changed: {
    invitation_id: APP,
    title: "Hamburg yard welders",
    employer_name: "Acme Bau",
    changed_fields: ["workers_needed", "occupations", "salary_max"],
    from_version: 1,
    to_version: 2,
    org_slug: "manila-recruit",
  },
  requirement_closed: { invitation_id: APP, title: "Hamburg yard welders", employer_name: "Acme Bau", close_reason: "filled", org_slug: "manila-recruit" },
  response_received: { response_id: APP, requirement_id: JOB, title: "Hamburg yard welders", partner_name: "Manila Recruit", org_slug: "acme-bau" },
  response_withdrawn: { response_id: APP, requirement_id: JOB, title: "Hamburg yard welders", partner_name: "Manila Recruit", org_slug: "acme-bau" },
  response_decided: { response_id: APP, requirement_id: JOB, title: "Hamburg yard welders", employer_name: "Acme Bau", decision: "selected", org_slug: "manila-recruit" },
  submission_request: { submission_id: APP, partner_name: "Manila Recruit", title: "Hamburg yard welders", country_name: "Germany", start_date: "2027-03-01", employer_name: "Acme Bau" },
  submission_request_signup: { partner_name: "Manila Recruit", title: "Germany, 10 Welders", country_name: "Germany", start_date: "2027-03-01" },
  submission_approved: { submission_id: APP, requirement_id: JOB, title: "Hamburg yard welders", partner_name: "Manila Recruit", org_slug: "acme-bau" },
  submission_withdrawn: { submission_id: APP, requirement_id: JOB, title: "Hamburg yard welders", partner_name: "Manila Recruit", org_slug: "acme-bau" },
  submission_stage_changed: { submission_id: APP, requirement_id: JOB, title: "Hamburg yard welders", status: "interview", org_slug: "manila-recruit" },
  visibility_confirmation: { respond_by: "2027-12-17T01:35:00+00:00" },
};

const LEAKS = {
  cover_note: "SECRET-COVER-NOTE",
  note: "SECRET-STAGE-NOTE",
  decline_reason: "SECRET-DECLINE",
  document: "SECRET-DOCUMENT.pdf",
  password: "SECRET-PASSWORD",
  token: "SECRET-TOKEN",
  email: "secret@example.test",
  fee_amount: "SECRET-FEE-1500",
  withdrawal_reason: "SECRET-WITHDRAWAL",
  experience_note: "SECRET-EXPERIENCE",
  decision_note: "SECRET-DECISION-NOTE",
};

const KINDS = Object.keys(SAMPLES) as NotificationKind[];

describe("notification templates", () => {
  it("cover every kind the database accepts, and only those", () => {
    const migrations = new URL("../../../../supabase/migrations/", import.meta.url);
    const declared = readdirSync(migrations)
      .sort()
      .map((file) => readFileSync(new URL(file, migrations), "utf8"))
      .flatMap((sql) => [...sql.matchAll(/check \(kind in \(([^)]*)\)\)/g)])
      .filter((match) => match[1].includes("application_received"));
    const list = declared.at(-1)?.[1] ?? "";
    const accepted = [...list.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort();
    expect(accepted).toEqual([...KINDS].sort());
    for (const kind of KINDS) {
      expect(isNotificationKind(kind)).toBe(true);
    }
    expect(isNotificationKind("newsletter")).toBe(false);
    expect(isNotificationKind("constructor")).toBe(false);
    expect(isNotificationKind(undefined)).toBe(false);
  });

  it("cover every kind of the notification catalogue (FR-T1), which holds every kind the database accepts", () => {
    const migrations = new URL("../../../../supabase/migrations/", import.meta.url);
    const catalogue = readdirSync(migrations)
      .sort()
      .map((file) => readFileSync(new URL(file, migrations), "utf8"))
      .flatMap((sql) => [...sql.matchAll(/insert into private\.notification_kinds \([^)]*\) values([\s\S]*?);/g)])
      .flatMap((match) => [...match[1].matchAll(/\(\s*'([a-z_]+)'/g)].map((row) => row[1]));
    expect(new Set(catalogue).size).toBe(catalogue.length);
    expect([...catalogue].sort()).toEqual([...KINDS].sort());
  });

  it.each(KINDS)("%s renders an English page, a plain text version and a one-line subject", async (kind) => {
    const email = await renderEmail(kind, SAMPLES[kind], SITE);
    expect(email.html).toContain('lang="en"');
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject.length).toBeGreaterThan(5);
    expect(email.text.length).toBeGreaterThan(40);
    expect(email.text).not.toContain("<");
  });

  it.each(KINDS)("%s names the product Chara Pinnacle in its header and footer and never the old name CHARA", async (kind) => {
    const email = await renderEmail(kind, SAMPLES[kind], SITE);
    expect(email.text.startsWith(BRAND_NAME)).toBe(true);
    expect(email.text).toContain(`This is a service email about your ${BRAND_NAME} account.`);
    // The plain text writes headings in capitals, so CHARA PINNACLE there is the new name.
    for (const part of [email.subject, email.text, email.html]) {
      expect(part).not.toMatch(/\bCHARA\b(?! PINNACLE)/);
    }
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
      application_received: applicantPath("en", "acme-bau", APP),
      status_changed: applicationPath("en", APP),
      vacancy_hidden: jobPath("en", "acme-bau", JOB),
      trial_ending: billingPath("en", "acme-bau"),
      payment_failed: billingPath("en", "acme-bau"),
      legal_version: "/en/legal/worker-terms",
      mfa_reset: "/en/login",
      account_suspended: "/en/legal/complaints-and-dispute-process",
      account_reinstated: "/en/login",
      deletion_requested: settingsPath("en"),
      member_invitation: `/en/invitations/${TOKEN}`,
      account_exists: "/en/login",
      partner_approved: "/en/dashboard/employer",
      partner_info_requested: "/en/onboarding?step=where-you-serve",
      partner_declined: "/en/dashboard/employer",
      licence_expiring: "/en/org/manila-recruit/workforce-profile#licences-heading",
      partner_licence_expired: "/en/org/manila-recruit/workforce-profile#licences-heading",
      listing_confirmation_due: "/en/org/manila-recruit/workforce-profile#availability-heading",
      followed_company_activity: "/en/companies/acme-bau",
      moderation_decision: appealPath("en", 42),
      data_export_ready: dataExportPath("en"),
      requirement_closing_soon: requirementPath("en", "acme-bau", JOB),
      job_order_match: jobOrderPath("en", "manila-recruit", JOB),
      invitation_received: invitationPath("en", "manila-recruit", APP),
      invitation_withdrawn: invitationPath("en", "manila-recruit", APP),
      requirement_changed: `${invitationPath("en", "manila-recruit", APP)}#changes`,
      requirement_closed: invitationPath("en", "manila-recruit", APP),
      response_received: requirementResponsesPath("en", "acme-bau", JOB),
      response_withdrawn: requirementResponsesPath("en", "acme-bau", JOB),
      response_decided: responsePath("en", "manila-recruit", APP),
      submission_request: submissionPath("en", APP),
      submission_request_signup: signUpPath("en", "worker"),
      submission_approved: requirementSubmissionsPath("en", "acme-bau", JOB),
      submission_withdrawn: requirementSubmissionsPath("en", "acme-bau", JOB),
      submission_stage_changed: requirementSubmissionsPath("en", "manila-recruit", JOB),
      visibility_confirmation: findWorkersCardPath("en"),
    };
    for (const [kind, path] of Object.entries(links)) {
      const email = await renderEmail(kind as NotificationKind, SAMPLES[kind as NotificationKind], SITE);
      expect(email.html, kind).toContain(`href="${SITE}${path}"`);
      expect(email.text, kind).toContain(`${SITE}${path}`);
    }
  });

  it("requirement_closing_soon names the requirement and its closing date and offers the extension (FR-M2 AC6)", async () => {
    const email = await renderEmail("requirement_closing_soon", SAMPLES.requirement_closing_soon, SITE);
    expect(email.subject).toBe('"Welders for Hamburg" closes on 10 April 2027');
    expect(email.text).toContain("partners can no longer respond to it");
    expect(email.text).toContain("Extend the requirement https://chara.example/en/org/acme-bau/requirements/");
    const foreign = await renderEmail("requirement_closing_soon", { ...SAMPLES.requirement_closing_soon, requirement_id: "../billing" }, SITE);
    expect(foreign.html).not.toContain("billing");
  });

  it("job_order_match names the generated title and the destination, links the recipient's own job order page and names no employer (FR-N1 AC10, NFR-S11)", async () => {
    const email = await renderEmail("job_order_match", { ...SAMPLES.job_order_match, employer_name: "Acme Bau", org_name: "Acme Bau" }, SITE);
    expect(email.subject).toBe("New job order: Germany, 100 Welders and flame cutters");
    expect(email.text).toContain('"Germany, 100 Welders and flame cutters" was published for Germany.');
    expect(email.text).toContain(`See the job order ${SITE}/en/org/manila-recruit/job-orders/${JOB}`);
    expect(email.text).toContain("notification settings");
    for (const part of [email.subject, email.text, email.html]) expect(part).not.toContain("Acme");
    const foreign = await renderEmail("job_order_match", { ...SAMPLES.job_order_match, requirement_id: "../billing" }, SITE);
    expect(foreign.html).not.toContain("billing");
  });

  it("invitation_received names the requirement, the employer the invitation reveals, destination, workers and start date (FR-O1 AC7, AC11)", async () => {
    const email = await renderEmail("invitation_received", { ...SAMPLES.invitation_received, member_name: "Jana Acme", member_email: "jana@acme.test" }, SITE);
    expect(email.subject).toBe("Invitation to a workforce requirement: Hamburg yard welders");
    expect(email.text).toContain('Acme Bau invited your company to "Hamburg yard welders" in Germany.');
    expect(email.text).toContain("Workers needed: 10. Start: 1 March 2027.");
    expect(email.text).toContain(`See the invitation ${SITE}/en/org/manila-recruit/invitations/${APP}`);
    for (const part of [email.subject, email.text, email.html]) {
      expect(part).not.toContain("Jana");
      expect(part).not.toContain("jana@acme.test");
    }
    const unnamed = await renderEmail("invitation_received", { ...SAMPLES.invitation_received, employer_name: undefined }, SITE);
    expect(unnamed.text).toContain('An employer invited your company to "Hamburg yard welders" in Germany.');
    const foreign = await renderEmail("invitation_received", { ...SAMPLES.invitation_received, invitation_id: "../billing" }, SITE);
    expect(foreign.html).not.toContain("billing");
  });

  it("invitation_withdrawn names the requirement and the employer and links the recipient's invitation page (FR-O1 AC10)", async () => {
    const email = await renderEmail("invitation_withdrawn", SAMPLES.invitation_withdrawn, SITE);
    expect(email.subject).toBe("Invitation withdrawn: Hamburg yard welders");
    expect(email.text).toContain('Acme Bau withdrew the invitation of your company to "Hamburg yard welders".');
    expect(email.text).toContain("You no longer need to answer it.");
    expect(email.text).toContain(`${SITE}/en/org/manila-recruit/invitations/${APP}`);
  });

  it("requirement_closing_soon to a partner links its invitation, names no employer and offers no extension (FR-M2 AC6, V43)", async () => {
    const payload = { ...SAMPLES.requirement_closing_soon, invitation_id: APP, org_slug: "manila-recruit", employer_name: "Acme Bau" };
    const email = await renderEmail("requirement_closing_soon", payload, SITE);
    expect(email.subject).toBe('"Welders for Hamburg" closes on 10 April 2027');
    expect(email.text).toContain("unless the employer extends it");
    expect(email.text).toContain(`See the invitation ${SITE}/en/org/manila-recruit/invitations/${APP}`);
    expect(email.text).not.toContain("Extend the requirement");
    for (const part of [email.subject, email.text, email.html]) expect(part).not.toContain("Acme");
    const untitled = await renderEmail("requirement_closing_soon", { invitation_id: APP }, SITE);
    expect(untitled.subject).toBe("A workforce requirement you are invited to closes soon");
    const foreign = await renderEmail("requirement_closing_soon", { ...payload, invitation_id: "../billing" }, SITE);
    expect(foreign.html).not.toContain("billing");
  });

  it("requirement_changed names the fields that changed, never their values, and links the changes (FR-M2 AC8, V43)", async () => {
    const email = await renderEmail("requirement_changed", { ...SAMPLES.requirement_changed, salary_max: 3600, changed_by: "Jana Acme" }, SITE);
    expect(email.subject).toBe("Workforce requirement changed: Hamburg yard welders");
    expect(email.text).toContain('Acme Bau changed "Hamburg yard welders", which your company is invited to.');
    expect(email.text).toContain("Changed: Number of workers, Occupations and Salary maximum.");
    expect(email.text).toContain(`See what changed ${SITE}/en/org/manila-recruit/invitations/${APP}#changes`);
    for (const part of [email.subject, email.text, email.html]) {
      expect(part).not.toContain("3600");
      expect(part).not.toContain("Jana");
    }
    const unknown = await renderEmail("requirement_changed", { ...SAMPLES.requirement_changed, changed_fields: ["<b>x</b>"] }, SITE);
    expect(unknown.text).not.toContain("Changed:");
    expect(unknown.html).not.toContain("<b>x</b>");
  });

  it("requirement_closed says why the requirement ended and that the invitation can no longer be answered (FR-M2 AC10, V43)", async () => {
    const filled = await renderEmail("requirement_closed", SAMPLES.requirement_closed, SITE);
    expect(filled.subject).toBe("Workforce requirement filled: Hamburg yard welders");
    expect(filled.text).toContain('"Hamburg yard welders" of Acme Bau, which your company was invited to, no longer takes responses.');
    expect(filled.text).toContain("The employer has filled it.");
    expect(filled.text).toContain("can no longer answer or respond to the invitation");
    const expired = await renderEmail("requirement_closed", { ...SAMPLES.requirement_closed, close_reason: "expired" }, SITE);
    expect(expired.subject).toBe("Workforce requirement closed: Hamburg yard welders");
    expect(expired.text).toContain("Its closing date has passed.");
    const cancelled = await renderEmail("requirement_closed", { ...SAMPLES.requirement_closed, close_reason: "cancelled" }, SITE);
    expect(cancelled.text).toContain("The employer closed it.");
    const odd = await renderEmail("requirement_closed", { ...SAMPLES.requirement_closed, close_reason: "constructor" }, SITE);
    expect(odd.text).not.toContain("function");
  });

  it("response_received and response_withdrawn name the partner and the requirement, never the proposal (FR-O2 AC1, FR-N2 AC8, FR-T1 AC2)", async () => {
    const received = await renderEmail("response_received", SAMPLES.response_received, SITE);
    expect(received.subject).toBe("New response to Hamburg yard welders");
    expect(received.text).toContain('Manila Recruit responded to "Hamburg yard welders".');
    expect(received.text).toContain("Chara Pinnacle is not a party to any agreement or payment between you and the partner.");
    const withdrawn = await renderEmail("response_withdrawn", SAMPLES.response_withdrawn, SITE);
    expect(withdrawn.subject).toBe("Response withdrawn: Hamburg yard welders");
    expect(withdrawn.text).toContain('Manila Recruit withdrew its response to "Hamburg yard welders".');
    const foreign = await renderEmail("response_received", { ...SAMPLES.response_received, requirement_id: "../billing" }, SITE);
    expect(foreign.html).not.toContain("billing");
    const untitled = await renderEmail("response_withdrawn", {}, SITE);
    expect(untitled.subject).toBe("A partner withdrew its response to your workforce requirement");
  });

  it("response_decided tells the partner its own decision, never the note, and names the employer only when the payload does (FR-O3 AC7, NFR-S11)", async () => {
    const selected = await renderEmail("response_decided", SAMPLES.response_decided, SITE);
    expect(selected.subject).toBe("Your company is selected: Hamburg yard welders");
    expect(selected.text).toContain('Acme Bau selected your company for "Hamburg yard welders". Your company can now submit candidates for it.');
    expect(selected.text).toContain("Chara Pinnacle is not a party to any agreement or payment between you and the employer.");
    expect(selected.text).toContain(`See your response ${SITE}${responsePath("en", "manila-recruit", APP)}`);
    const declined = await renderEmail(
      "response_decided",
      { response_id: APP, title: "Germany, 10 Welders", decision: "declined", org_slug: "manila-recruit", decision_note: "Fee above budget" },
      SITE,
    );
    expect(declined.subject).toBe("Your response is declined: Germany, 10 Welders");
    expect(declined.text).toContain('The employer declined your company\'s response to "Germany, 10 Welders".');
    expect(declined.text).not.toContain("Fee above budget");
    expect(declined.text).not.toContain("not a party");
    const shortlisted = await renderEmail("response_decided", { ...SAMPLES.response_decided, decision: "shortlisted" }, SITE);
    expect(shortlisted.text).toContain('Acme Bau shortlisted your company\'s response to "Hamburg yard welders".');
    const allowed = await renderEmail("response_decided", { ...SAMPLES.response_decided, decision: "submissions_allowed" }, SITE);
    expect(allowed.subject).toBe("You can submit candidates: Hamburg yard welders");
    const odd = await renderEmail("response_decided", { decision: "constructor", response_id: "../billing" }, SITE);
    expect(odd.subject).toBe("The employer decided your response");
    expect(odd.html).not.toContain("billing");
  });

  it("the submission request asks the candidate first, names the employer only when the payload does and says workers never pay (FR-O4 AC1, AC10, AC11)", async () => {
    const request = await renderEmail("submission_request", SAMPLES.submission_request, SITE);
    expect(request.subject).toBe("Manila Recruit would like to propose you for a job");
    expect(request.text).toContain('Manila Recruit would like to submit you as a candidate for "Hamburg yard welders" at Acme Bau in Germany, starting on 1 March 2027.');
    expect(request.text).toContain("Nothing is shared with the employer until you approve the request and choose which documents to share.");
    expect(request.text).toContain("Workers never pay fees to get a job through Chara Pinnacle.");
    const unnamed = await renderEmail("submission_request", { submission_id: APP, partner_name: "Manila Recruit", title: "Germany, 10 Welders" }, SITE);
    expect(unnamed.text).toContain('for "Germany, 10 Welders".');
    expect(unnamed.text).not.toContain("Acme");
    const odd = await renderEmail("submission_request", { submission_id: "../billing" }, SITE);
    expect(odd.html).not.toContain("billing");
  });

  it("the invitation to an address without an account offers a worker account and shares nothing yet (FR-O4 AC2, AC10)", async () => {
    const email = await renderEmail("submission_request_signup", SAMPLES.submission_request_signup, SITE);
    expect(email.subject).toBe("Manila Recruit would like to propose you for a job");
    expect(email.text).toContain("create a free worker account on Chara Pinnacle with this email address");
    expect(email.text).toContain("Nothing is shared with the employer until you approve.");
    expect(email.text).toContain(`Create your account ${SITE}${signUpPath("en", "worker")}`);
  });

  it("the approval and the withdrawal name the partner and the requirement, never the candidate (FR-O4 AC5, AC9, NFR-S9)", async () => {
    const approved = await renderEmail("submission_approved", { ...SAMPLES.submission_approved, candidate_name: "SECRET-NAME" }, SITE);
    expect(approved.subject).toBe("Candidate submitted: Hamburg yard welders");
    expect(approved.text).toContain('A candidate proposed by Manila Recruit approved the submission for "Hamburg yard welders".');
    expect(approved.text).not.toContain("SECRET-NAME");
    const withdrawn = await renderEmail("submission_withdrawn", SAMPLES.submission_withdrawn, SITE);
    expect(withdrawn.subject).toBe("Candidate withdrawn: Hamburg yard welders");
    expect(withdrawn.text).toContain("The documents the candidate shared can no longer be opened.");
  });

  it("the partner's own approval and withdrawal speak of the candidate it proposed, not of its own name (FR-O4 AC5, AC9)", async () => {
    const approved = await renderEmail("submission_approved", { ...SAMPLES.submission_approved, to_partner: true }, SITE);
    expect(approved.text).toContain('A candidate you proposed approved the submission for "Hamburg yard welders".');
    expect(approved.text).not.toContain("Manila Recruit");
    const withdrawn = await renderEmail("submission_withdrawn", { ...SAMPLES.submission_withdrawn, to_partner: true }, SITE);
    expect(withdrawn.text).toContain('A candidate you proposed withdrew from "Hamburg yard welders".');
    expect(withdrawn.text).not.toContain("Manila Recruit");
    const employer = await renderEmail("submission_withdrawn", { ...SAMPLES.submission_withdrawn, to_partner: false }, SITE);
    expect(employer.text).toContain('A candidate proposed by Manila Recruit withdrew from "Hamburg yard welders".');
  });

  it("a submitted candidate's stage names the partner to the candidate and the stage alone to the partner (FR-O5 AC9, AC10)", async () => {
    const candidate = await renderEmail(
      "status_changed",
      { submission_id: APP, job_title: "Hamburg yard welders", org_name: "Acme Bau", partner_name: "Manila Recruit", status: "interview", ...LEAKS },
      SITE,
    );
    expect(candidate.subject).toBe("Update on your submission for Hamburg yard welders");
    expect(candidate.text).toContain("Your submission by Manila Recruit for Hamburg yard welders at Acme Bau is now: Interview.");
    expect(candidate.text).toContain(`${SITE}${submissionPath("en", APP)}`);
    expect(candidate.text).not.toContain("SECRET-STAGE-NOTE");
    const partner = await renderEmail("submission_stage_changed", { ...SAMPLES.submission_stage_changed, ...LEAKS }, SITE);
    expect(partner.subject).toBe("Candidate update: Hamburg yard welders");
    expect(partner.text).toContain('A candidate you submitted for "Hamburg yard welders" is now: Interview.');
    for (const secret of ["SECRET-STAGE-NOTE", "SECRET-DECLINE"]) expect(partner.text).not.toContain(secret);
  });

  it("the notices of V43 to a company that responded on the marketplace link its response and name no employer (FR-M2 AC6 P5, V44)", async () => {
    const base = { response_id: APP, title: "Germany, 10 Welders and flame cutters", org_slug: "manila-recruit" };
    const changed = await renderEmail("requirement_changed", { ...base, changed_fields: ["workers_needed"] }, SITE);
    expect(changed.text).toContain('The employer changed "Germany, 10 Welders and flame cutters", which your company responded to.');
    expect(changed.text).toContain(`See what changed ${SITE}${responsePath("en", "manila-recruit", APP)}#changes`);
    expect(changed.text).toContain("Your response shows the old and the new values.");
    const closed = await renderEmail("requirement_closed", { ...base, close_reason: "filled" }, SITE);
    expect(closed.text).toContain("which your company responded to, no longer takes responses. The employer has filled it.");
    expect(closed.text).toContain(`See your response ${SITE}${responsePath("en", "manila-recruit", APP)}`);
    expect(closed.text).not.toContain("invitation");
    const soon = await renderEmail("requirement_closing_soon", { ...base, requirement_id: JOB, closes_on: "2027-04-10" }, SITE);
    expect(soon.text).toContain(`See your response ${SITE}${responsePath("en", "manila-recruit", APP)}`);
    expect(soon.text).not.toContain("Extend the requirement");
    for (const kind of ["requirement_changed", "requirement_closed", "requirement_closing_soon"] as const) {
      const untitled = await renderEmail(kind, { response_id: APP }, SITE);
      expect(untitled.subject, kind).toContain("you responded to");
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
      expect(email.text).toContain(`Acme Bau is now: ${label}.`);
      expect(email.text).toContain("Welder MIG/MAG");
    }
    const withdrawn = await renderEmail("status_changed", { ...SAMPLES.status_changed, status: "withdrawn" }, SITE);
    expect(withdrawn.text).toContain("You withdrew your application for Welder MIG/MAG at Acme Bau.");
    const unknown = await renderEmail("status_changed", { ...SAMPLES.status_changed, status: "<script>" }, SITE);
    expect(unknown.html).not.toContain("<script>");
    expect(unknown.text).toContain("There is an update on your application");
  });

  it("application_received and status_changed carry the subjects of the application emails and name the organisation", async () => {
    const received = await renderEmail("application_received", SAMPLES.application_received, SITE);
    expect(received.subject).toBe("New application for Welder MIG/MAG");
    expect(received.text).toContain("Welder MIG/MAG at Acme Bau");
    const changed = await renderEmail("status_changed", SAMPLES.status_changed, SITE);
    expect(changed.subject).toBe("Update on your application for Welder MIG/MAG");
    expect(changed.text).toContain("Welder MIG/MAG at Acme Bau is now: Interview.");
    expect(changed.text).toContain("journey tracker");
  });

  it("application_received in the daily summary lists each vacancy with its count and one link", async () => {
    const summary = {
      total: 3,
      vacancies: [
        { job_id: JOB, job_title: "Welder MIG/MAG", org_name: "Acme Bau", org_slug: "acme-bau", count: 2 },
        { job_id: APP, job_title: "Pipe fitter", org_name: "Beta GmbH", org_slug: "beta", count: 1 },
      ],
    };
    const email = await renderEmail("application_received", summary, SITE);
    expect(email.subject).toBe("Your daily summary of new applications");
    expect(email.text).toContain("You received 3 applications since the last summary.");
    expect(email.text).toContain("Welder MIG/MAG (Acme Bau): 2 applications.");
    expect(email.text).toContain("Pipe fitter (Beta GmbH): 1 application.");
    expect(email.html).toContain(`href="${SITE}${applicantsPath("en", "acme-bau", { job: JOB })}"`);
    expect(email.html).toContain(`href="${SITE}${applicantsPath("en", "beta", { job: APP })}"`);
    expect(email.text).not.toContain("And applications for other vacancies");
    const capped = await renderEmail("application_received", { ...summary, total: 25 }, SITE);
    expect(capped.text).toContain("You received 25 applications");
    expect(capped.text).toContain("And applications for other vacancies.");
  });

  it("application_received in the daily summary ignores a vacancy that is not whole and anything else in the payload", async () => {
    const email = await renderEmail(
      "application_received",
      { total: 2, vacancies: [{ job_title: "No link", count: 2 }], ...LEAKS },
      SITE,
    );
    expect(email.text).not.toContain("No link");
    for (const secret of Object.values(LEAKS)) expect(email.html).not.toContain(secret);
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
    expect(email.subject).toBe("Your Chara Pinnacle trial ends on 1 November 2026");
    expect(email.text).toContain("ends on 1 November 2026");
    expect(email.text).toContain("Employer starter");
    expect(email.text).toContain("€39.00");
    const yen = await renderEmail("trial_ending", { ...SAMPLES.trial_ending, amount_minor: 5000, currency: "JPY" }, SITE);
    expect(yen.text).toContain("¥5,000");
    const noPrice = await renderEmail("trial_ending", { ...SAMPLES.trial_ending, currency: "euro" }, SITE);
    expect(noPrice.text).not.toContain("costs");
  });

  it("trial_ending shows the plan name, the long UTC date and the price per month excluding VAT", async () => {
    const email = await renderEmail(
      "trial_ending",
      { ...SAMPLES.trial_ending, trial_ends_at: "2026-11-10T16:32:25.527Z", plan_code: "employer_starter", plan_name: "Basic" },
      SITE,
    );
    expect(email.subject).toBe("Your Chara Pinnacle trial ends on 10 November 2026");
    expect(email.text).toContain("Your free trial of the Basic plan ends on 10 November 2026.");
    expect(email.text).toContain("After that the plan costs €39.00 per month, excluding VAT, charged to your payment method.");
    expect(email.text).not.toContain("Employer starter");
    expect(email.text).not.toContain("2026-11-10");
    expect(email.text).not.toContain("billing period");
    const late = await renderEmail("trial_ending", { ...SAMPLES.trial_ending, trial_ends_at: "2026-11-10T23:30:00-05:00" }, SITE);
    expect(late.subject).toBe("Your Chara Pinnacle trial ends on 11 November 2026");
    const database = await renderEmail("trial_ending", { ...SAMPLES.trial_ending, trial_ends_at: "2026-11-10 16:32:25.527+00" }, SITE);
    expect(database.subject).toBe("Your Chara Pinnacle trial ends on 10 November 2026");
  });

  it("trial_ending falls back when the date is missing or not a date and when the plan name is missing", async () => {
    for (const trial_ends_at of [undefined, "", "soon", "2026-13-45"]) {
      const email = await renderEmail("trial_ending", { ...SAMPLES.trial_ending, trial_ends_at }, SITE);
      expect(email.subject).toBe("Your Chara Pinnacle trial ends on soon");
      expect(email.text).toContain("ends on the date shown in your billing page.");
    }
    const noPlan = await renderEmail("trial_ending", { org_slug: "acme-bau" }, SITE);
    expect(noPlan.text).toContain("Your free trial ends on");
    const blankName = await renderEmail("trial_ending", { ...SAMPLES.trial_ending, plan_name: "" }, SITE);
    expect(blankName.text).toContain("Employer starter");
  });

  it("payment_failed, deletion_requested and deletion_completed name the product in their subjects", async () => {
    expect((await renderEmail("payment_failed", SAMPLES.payment_failed, SITE)).subject).toBe("We could not collect your Chara Pinnacle payment");
    expect((await renderEmail("deletion_requested", SAMPLES.deletion_requested, SITE)).subject).toBe(
      "We received your request to delete your Chara Pinnacle account",
    );
    const completed = await renderEmail("deletion_completed", SAMPLES.deletion_completed, SITE);
    expect(completed.subject).toBe("Your Chara Pinnacle account was deleted");
    expect(completed.text).toContain("Thank you for using Chara Pinnacle.");
  });

  it("deletion_requested shows the date of the erasure", async () => {
    const email = await renderEmail("deletion_requested", SAMPLES.deletion_requested, SITE);
    expect(email.text).toContain("erased on 2026-11-02");
    const none = await renderEmail("deletion_requested", { erases_on: "soon" }, SITE);
    expect(none.text).not.toContain("erased on");
  });

  it("account_suspended and account_reinstated quote the reasons and say whether a person or an organisation is meant", async () => {
    const person = await renderEmail("account_suspended", SAMPLES.account_suspended, SITE);
    expect(person.subject).toBe("Your Chara Pinnacle account was suspended");
    expect(person.text).toContain("Repeated fake profile reports.");
    expect(person.text).toContain("cannot sign in until it is reinstated");
    const org = await renderEmail("account_suspended", { ...SAMPLES.account_suspended, org_name: "Acme Bau", org_slug: "acme-bau" }, SITE);
    expect(org.subject).toBe("Your organisation Acme Bau was suspended");
    expect(org.text).toContain("suspended the organisation Acme Bau");
    const back = await renderEmail("account_reinstated", SAMPLES.account_reinstated, SITE);
    expect(back.subject).toBe("Your Chara Pinnacle account was reinstated");
    expect(back.text).toContain("Identity confirmed after the complaint.");
    const backOrg = await renderEmail("account_reinstated", { ...SAMPLES.account_reinstated, org_name: "Acme Bau" }, SITE);
    expect(backOrg.subject).toBe("Your organisation Acme Bau was reinstated");
    expect(backOrg.text).toContain("except any that moderators hid on their own");
  });

  it("legal_version quotes the change summary", async () => {
    const email = await renderEmail("legal_version", SAMPLES.legal_version, SITE);
    expect(email.text).toContain("Adds retention periods for application data.");
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
  it("member_invitation shows the organisation, the role, the expiry date and one link to the invitation page", async () => {
    const email = await renderEmail("member_invitation", SAMPLES.member_invitation, SITE);
    expect(email.subject).toBe("You are invited to join Acme Bau on Chara Pinnacle");
    expect(email.html).toContain('lang="en"');
    expect(email.text).toContain("Chara Pinnacle");
    expect(email.text).toContain("Acme Bau invited you to join its team on Chara Pinnacle as a member.");
    expect(email.text).toContain("valid until 2026-10-15 and can be used once.");
    expect(email.html.match(/href="/g)).toHaveLength(1);
    expect(email.html).toContain(`href="${SITE}/en/invitations/${TOKEN}"`);
    expect(email.text).toContain(`${SITE}/en/invitations/${TOKEN}`);
    expect(email.text).toMatch(/if you were not expecting this invitation, ignore\s+this email/i);
    const admin = await renderEmail("member_invitation", { ...SAMPLES.member_invitation, role: "admin" }, SITE);
    expect(admin.text).toContain("as an administrator.");
  });

  it("member_invitation names the account of the inviting organisation's type, an employer account when none is given (FR-J1)", async () => {
    const employer = await renderEmail("member_invitation", SAMPLES.member_invitation, SITE);
    expect(employer.text).toMatch(/You need a Chara Pinnacle employer account with this email address/);
    const recruitment = await renderEmail("member_invitation", { ...SAMPLES.member_invitation, org_type: "recruitment_company" }, SITE);
    expect(recruitment.text).toMatch(/You need a Chara Pinnacle recruitment company account with this email address/);
    const staffing = await renderEmail("member_invitation", { ...SAMPLES.member_invitation, org_type: "staffing_company" }, SITE);
    expect(staffing.text).toMatch(/You need a Chara Pinnacle staffing company account with this email address/);
    const unknown = await renderEmail("member_invitation", { ...SAMPLES.member_invitation, org_type: "<b>x</b>" }, SITE);
    expect(unknown.text).toMatch(/employer account with this email address/);
  });

  it("member_invitation has no link when the token is missing or is not a token, and never shows the invitation id", async () => {
    for (const token of [undefined, "short", "SECRET-TOKEN", `${TOKEN}x`, "../../logout"]) {
      const email = await renderEmail("member_invitation", { ...SAMPLES.member_invitation, token }, SITE);
      expect(email.html).not.toContain("href=");
      expect(email.text).not.toContain("/invitations/");
    }
    const email = await renderEmail("member_invitation", SAMPLES.member_invitation, SITE);
    expect(email.html).not.toContain(ACCOUNT);
    expect(email.text).not.toContain(ACCOUNT);
    const open = await renderEmail("member_invitation", { ...SAMPLES.member_invitation, expires_at: "soon", org_name: undefined }, SITE);
    expect(open.text).toContain("An organisation invited you");
    expect(open.text).toContain("It can be used once and expires.");
  });

  it("mfa_reset says the factors were removed and must be enrolled again, with no code, secret or way around two-step verification", async () => {
    const email = await renderEmail("mfa_reset", {}, SITE);
    expect(email.subject).toBe("Two-step verification was reset on your Chara Pinnacle account");
    expect(email.text).toContain("Chara Pinnacle");
    expect(email.text).toContain("removed the two-step verification factors");
    expect(email.text).toContain("you must enrol again");
    expect(email.text).toMatch(/if you did not ask for this, reply to this\s+email or contact support at once/i);
    expect(email.html.match(/href="/g)).toHaveLength(1);
    expect(email.html).toContain(`href="${SITE}/en/login"`);
    expect(email.text).not.toMatch(/\b\d{6,}\b|secret|token|otp|recovery code|backup code|skip/i);
  });

  it("account_exists says the address already has an account, with a Log in button and a reset link, and no address or secret", async () => {
    const email = await renderEmail("account_exists", {}, SITE);
    expect(email.subject).toBe("You already have a Chara Pinnacle account");
    expect(email.text).toContain("already belongs to an account");
    expect(email.text).toContain("No new account was created and nothing in your account was changed.");
    expect(email.html).toContain(`href="${SITE}/en/login"`);
    expect(email.text).toContain(`Log in ${SITE}/en/login`);
    expect(email.html).toContain(`<a href="${SITE}/en/forgot-password">Reset your password</a>`);
    expect(email.html.match(/href="/g)).toHaveLength(2);
    expect(email.text).toMatch(/if it was not you, you can ignore this email/i);
    expect(`${email.subject}${email.text}`).not.toMatch(/@|password:|token|\b\d{6,}\b/i);
  });
});
