import { describe, expect, it } from "vitest";
import { isNotificationKind } from "@/emails/index";
import { badgeText, bellLabel } from "@/lib/notifications/bell";
import { presentedKinds, presentNotification } from "@/lib/notifications/present";
import { appealPath, applicantPath, applicationPath, billingPath, companyPagePath, dataExportPath, employerDashboardPath, homePath, invitationPath, jobOrderPath, jobPath, mfaPath, myReportsPath, requirementPath, requirementResponsesPath, requirementSubmissionsPath, responsePath, settingsPath, submissionPath, workforceProfilePath } from "@/lib/routes";

const APP = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const company = { lang: "en", accountKind: "company" } as const;
const worker = { lang: "en", accountKind: "worker" } as const;

// Kinds whose rows have no user (sent to an address) or that the in-app list never shows (DATA_MODEL.md section 9).
const NOT_LISTED = ["deletion_completed", "member_invitation", "erasure_paused", "submission_request_signup"];

describe("in-app notification items (FR-T1)", () => {
  it("present every kind a user can find in the list, and only kinds of the catalogue", () => {
    for (const kind of presentedKinds) expect(isNotificationKind(kind), kind).toBe(true);
    const all = [...presentedKinds, ...NOT_LISTED].sort();
    expect(all.every(isNotificationKind)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });

  it.each([
    ["application_received", { application_id: APP, job_title: "Welder", org_slug: "acme" }, company, "New application for Welder", applicantPath("en", "acme", APP)],
    ["status_changed", { application_id: APP, job_title: "Welder", status: "rejected" }, worker, "Your application for Welder is now Not selected", applicationPath("en", APP)],
    ["status_changed", { application_id: APP, job_title: "Welder", status: "withdrawn" }, worker, "You withdrew your application for Welder", applicationPath("en", APP)],
    ["vacancy_hidden", { job_id: JOB, job_title: "Welder", org_slug: "acme" }, company, "Welder was hidden by moderation", jobPath("en", "acme", JOB)],
    ["trial_ending", { org_slug: "acme", trial_ends_at: "2026-11-01T00:00:00Z" }, company, "Your trial ends on 1 November 2026", billingPath("en", "acme")],
    ["payment_failed", { org_slug: "acme" }, company, "A payment for your subscription failed", billingPath("en", "acme")],
    ["legal_version", { document_slug: "worker-terms", version: 3 }, worker, "New version of the Worker terms", "/en/legal/worker-terms"],
    ["mfa_reset", {}, company, "Your two-step verification was reset", mfaPath("en")],
    ["deletion_requested", { erases_on: "2026-11-02T08:00:00+00:00" }, worker, "Your account will be deleted on 2 November 2026", settingsPath("en")],
    ["account_suspended", { reasons: "x" }, worker, "Your account was suspended", "/en/suspended"],
    ["account_suspended", { reasons: "x", org_name: "Acme Bau", moderation_action_id: 6 }, company, "Acme Bau was suspended", appealPath("en", 6)],
    ["account_reinstated", {}, worker, "Your account was reinstated", homePath("en", "worker")],
    ["account_exists", {}, company, "Someone tried to sign up with your email address", null],
    ["partner_approved", { org_name: "Manila Recruit", org_slug: "manila" }, company, "Manila Recruit is now listed in the partner directories", employerDashboardPath("en")],
    ["partner_info_requested", { info_step: "company", reason: "x" }, company, "Our team needs more information about your company details", employerDashboardPath("en")],
    ["partner_info_requested", { info_step: "where_you_serve" }, company, "Our team needs more information about where you serve and what you offer", employerDashboardPath("en")],
    ["partner_info_requested", { info_step: "commitments" }, company, "Our team needs more information about the employer-pays commitment", employerDashboardPath("en")],
    ["partner_info_requested", { info_step: "security" }, company, "Our team needs more information about your company", employerDashboardPath("en")],
    ["partner_declined", { org_name: "Manila Recruit", reason: "x" }, company, "Manila Recruit was not listed in the partner directories", employerDashboardPath("en")],
    ["licence_expiring", { country_name: "Philippines", valid_until: "2026-12-26", org_slug: "manila" }, company, "Your licence for Philippines expires on 26 December 2026", `${workforceProfilePath("en", "manila")}#licences-heading`],
    ["licence_expiring", { valid_until: "not a date" }, company, "Your licence expires soon", null],
    ["partner_licence_expired", { country_name: "Philippines", org_slug: "manila" }, company, "Your licence for Philippines has expired", `${workforceProfilePath("en", "manila")}#licences-heading`],
    ["listing_confirmation_due", { total: 3, org_slug: "manila" }, company, "3 availability listings need confirming", `${workforceProfilePath("en", "manila")}#availability-heading`],
    ["listing_confirmation_due", { total: 1, org_slug: "manila" }, company, "1 availability listing needs confirming", `${workforceProfilePath("en", "manila")}#availability-heading`],
    ["listing_confirmation_due", {}, company, "Some availability listings need confirming", null],
    ["followed_company_activity", { org_name: "Acme Bau", org_slug: "acme", total: 1, vacancies: [{ job_id: JOB, job_title: "Welder" }] }, worker, "Acme Bau published a new vacancy: Welder", companyPagePath("en", "acme")],
    ["followed_company_activity", { org_name: "Acme Bau", org_slug: "acme", total: 3, vacancies: [{ job_id: JOB, job_title: "Welder" }] }, company, "Acme Bau published 3 new vacancies", companyPagePath("en", "acme")],
    ["followed_company_activity", {}, worker, "A company you follow published new vacancies", null],
    ["followed_company_activity", { org_name: "Acme Bau", org_slug: "acme", total: 0, vacancies: [], job_order_total: 1, partner_slug: "manila", job_orders: [{ requirement_id: JOB, title: "Hamburg welders" }] }, company, "Acme Bau published a new job order: Hamburg welders", jobOrderPath("en", "manila", JOB)],
    ["followed_company_activity", { org_name: "Acme Bau", org_slug: "acme", total: 0, vacancies: [], job_order_total: 1, job_orders: [{ title: "Hamburg welders" }] }, worker, "Acme Bau published a new job order: Hamburg welders", companyPagePath("en", "acme")],
    ["followed_company_activity", { org_name: "Acme Bau", org_slug: "acme", total: 0, vacancies: [], job_order_total: 1, partner_slug: "manila", job_orders: [{ requirement_id: "../billing", title: "Hamburg welders" }] }, company, "Acme Bau published a new job order: Hamburg welders", companyPagePath("en", "acme")],
    ["followed_company_activity", { org_name: "Acme Bau", org_slug: "acme", total: 0, vacancies: [], job_order_total: 2, partner_slug: "manila", job_orders: [{ requirement_id: JOB, title: "Hamburg welders" }] }, company, "Acme Bau published 2 new job orders", companyPagePath("en", "acme")],
    ["followed_company_activity", { org_name: "Acme Bau", org_slug: "acme", total: 1, vacancies: [{ job_id: JOB, job_title: "Welder" }], job_order_total: 1, partner_slug: "manila", job_orders: [{ requirement_id: JOB, title: "Hamburg welders" }] }, company, "Acme Bau published 1 new vacancy and 1 new job order", companyPagePath("en", "acme")],
    ["moderation_decision", { target_type: "partner_profile", title: "Manila Recruit", org_slug: "manila", decision: "hide", reasons: "x" }, company, "Manila Recruit was hidden by moderation", `${workforceProfilePath("en", "manila")}#moderation-heading`],
    ["moderation_decision", { target_type: "partner_profile", title: "Manila Recruit", org_slug: "manila", decision: "unhide" }, company, "Manila Recruit is shown again", workforceProfilePath("en", "manila")],
    ["moderation_decision", { reference: "R-000123", outcome: "actioned" }, worker, "Your report R-000123 was closed", myReportsPath("en")],
    ["moderation_decision", {}, company, "Your public profile was hidden by moderation", null],
    ["moderation_decision", { target_type: "partner_profile", title: "Manila Recruit", appeal_id: 7, appeal_outcome: "restored", moderation_action_id: 42 }, company, "Your appeal about Manila Recruit was decided: the decision was reversed", appealPath("en", 42)],
    ["moderation_decision", { target_type: "job", appeal_id: 7, appeal_outcome: "upheld" }, company, "Your appeal was decided: the decision was upheld", null],
    ["data_export_ready", { export_id: APP, expires_at: "2026-12-17T08:00:00+00:00" }, worker, "Your data is ready to download until 17 December 2026", dataExportPath("en")],
    ["data_export_ready", {}, company, "Your data is ready to download", dataExportPath("en")],
    ["requirement_closing_soon", { requirement_id: JOB, title: "Welders for Hamburg", closes_on: "2027-04-10", org_slug: "acme" }, company, '"Welders for Hamburg" closes on 10 April 2027', requirementPath("en", "acme", JOB)],
    ["requirement_closing_soon", { requirement_id: "../x", org_slug: "acme" }, company, "A workforce requirement closes soon", null],
    ["job_order_match", { requirement_id: JOB, title: "Germany, 100 Welders and flame cutters", country_code: "DE", country_name: "Germany", org_slug: "manila" }, company, "New job order: Germany, 100 Welders and flame cutters", jobOrderPath("en", "manila", JOB)],
    ["job_order_match", { requirement_id: "../billing", org_slug: "manila" }, company, "A new job order fits your company", null],
    ["invitation_received", { invitation_id: APP, title: "Germany, 10 Welders and flame cutters", org_slug: "manila" }, company, 'An employer invited your company to "Germany, 10 Welders and flame cutters"', invitationPath("en", "manila", APP)],
    ["invitation_received", { invitation_id: APP, title: "Hamburg welders", employer_name: "Acme Bau", org_slug: "manila" }, company, 'Acme Bau invited your company to "Hamburg welders"', invitationPath("en", "manila", APP)],
    ["invitation_received", { invitation_id: "../billing", org_slug: "manila" }, company, "An employer invited your company to a workforce requirement", null],
    ["invitation_withdrawn", { invitation_id: APP, title: "Hamburg welders", employer_name: "Acme Bau", org_slug: "manila" }, company, 'Acme Bau withdrew the invitation to "Hamburg welders"', invitationPath("en", "manila", APP)],
    ["invitation_withdrawn", { invitation_id: "../x", org_slug: "manila" }, company, "The employer withdrew the invitation to a workforce requirement", null],
    ["requirement_closing_soon", { requirement_id: JOB, invitation_id: APP, title: "Hamburg welders", closes_on: "2027-04-10", org_slug: "manila" }, company, '"Hamburg welders" closes on 10 April 2027', invitationPath("en", "manila", APP)],
    ["requirement_closing_soon", { requirement_id: JOB, invitation_id: "../x", org_slug: "manila" }, company, "A workforce requirement closes soon", null],
    ["requirement_changed", { invitation_id: APP, title: "Hamburg welders", employer_name: "Acme Bau", changed_fields: ["workers_needed", "occupations", "salary_max"], org_slug: "manila" }, company, 'Acme Bau changed "Hamburg welders": Number of workers, Occupations and Salary maximum', `${invitationPath("en", "manila", APP)}#changes`],
    ["requirement_changed", { invitation_id: APP, title: "Hamburg welders", employer_name: "Acme Bau", changed_fields: ["title", "<script>", 3], org_slug: "manila" }, company, 'Acme Bau changed "Hamburg welders": Title', `${invitationPath("en", "manila", APP)}#changes`],
    ["requirement_changed", { invitation_id: "../x", changed_fields: "workers_needed", org_slug: "manila" }, company, "The employer changed a workforce requirement", null],
    ["requirement_closed", { invitation_id: APP, title: "Hamburg welders", employer_name: "Acme Bau", close_reason: "filled", org_slug: "manila" }, company, '"Hamburg welders" is filled', invitationPath("en", "manila", APP)],
    ["requirement_closed", { invitation_id: APP, title: "Hamburg welders", close_reason: "expired", org_slug: "manila" }, company, '"Hamburg welders" is closed', invitationPath("en", "manila", APP)],
    ["requirement_closed", {}, company, "A workforce requirement you are invited to is closed", null],
    ["requirement_changed", { response_id: APP, title: "Germany, 10 Welders and flame cutters", changed_fields: ["start_date"], org_slug: "manila" }, company, 'The employer changed "Germany, 10 Welders and flame cutters": Start date', `${responsePath("en", "manila", APP)}#changes`],
    ["requirement_closed", { response_id: APP, close_reason: "filled", org_slug: "manila" }, company, "A workforce requirement you responded to is filled", responsePath("en", "manila", APP)],
    ["requirement_closing_soon", { requirement_id: JOB, response_id: APP, title: "Germany, 10 Welders", closes_on: "2027-04-10", org_slug: "manila" }, company, '"Germany, 10 Welders" closes on 10 April 2027', responsePath("en", "manila", APP)],
    ["requirement_closing_soon", { requirement_id: JOB, response_id: "../x", org_slug: "manila" }, company, "A workforce requirement closes soon", null],
    ["response_received", { response_id: APP, requirement_id: JOB, title: "Hamburg welders", partner_name: "Manila Recruit", org_slug: "acme" }, company, 'Manila Recruit responded to "Hamburg welders"', requirementResponsesPath("en", "acme", JOB)],
    ["response_received", { requirement_id: "../billing", org_slug: "acme" }, company, "A partner responded to your workforce requirement", null],
    ["response_withdrawn", { response_id: APP, requirement_id: JOB, title: "Hamburg welders", partner_name: "Manila Recruit", org_slug: "acme" }, company, 'Manila Recruit withdrew its response to "Hamburg welders"', requirementResponsesPath("en", "acme", JOB)],
    ["response_withdrawn", {}, company, "A partner withdrew its response to your workforce requirement", null],
    ["response_decided", { response_id: APP, title: "Hamburg welders", employer_name: "Acme Bau", decision: "shortlisted", org_slug: "manila" }, company, 'Acme Bau shortlisted your response to "Hamburg welders"', responsePath("en", "manila", APP)],
    ["response_decided", { response_id: APP, title: "Germany, 10 Welders", decision: "declined", org_slug: "manila" }, company, 'The employer declined your response to "Germany, 10 Welders"', responsePath("en", "manila", APP)],
    ["response_decided", { response_id: APP, title: "Hamburg welders", employer_name: "Acme Bau", decision: "selected", org_slug: "manila" }, company, 'Acme Bau selected your company for "Hamburg welders"', responsePath("en", "manila", APP)],
    ["response_decided", { response_id: APP, decision: "submissions_allowed", org_slug: "manila" }, company, "The employer allows your company to submit candidates for a workforce requirement", responsePath("en", "manila", APP)],
    ["response_decided", { response_id: "../x", decision: "constructor", org_slug: "manila" }, company, "The employer decided your response to a workforce requirement", null],
    ["submission_request", { submission_id: APP, partner_name: "Manila Recruit", title: "Hamburg welders" }, worker, 'Manila Recruit would like to propose you for "Hamburg welders"', submissionPath("en", APP)],
    ["submission_request", { submission_id: "../x" }, worker, "A recruitment company would like to propose you for a job", null],
    ["submission_approved", { requirement_id: JOB, title: "Hamburg welders", partner_name: "Manila Recruit", org_slug: "acme" }, company, 'A candidate proposed by Manila Recruit was submitted for "Hamburg welders"', requirementSubmissionsPath("en", "acme", JOB)],
    ["submission_withdrawn", { requirement_id: JOB, title: "Hamburg welders", partner_name: "Manila Recruit", org_slug: "manila" }, company, 'A candidate proposed by Manila Recruit withdrew from "Hamburg welders"', requirementSubmissionsPath("en", "manila", JOB)],
    ["submission_withdrawn", {}, company, "A candidate proposed by a partner withdrew from a workforce requirement", null],
    ["submission_approved", { requirement_id: JOB, title: "Germany, 10 Welders", partner_name: "Manila Recruit", org_slug: "manila", to_partner: true }, company, 'A candidate you proposed was submitted for "Germany, 10 Welders"', requirementSubmissionsPath("en", "manila", JOB)],
    ["submission_withdrawn", { requirement_id: JOB, title: "Germany, 10 Welders", partner_name: "Manila Recruit", org_slug: "manila", to_partner: true }, company, 'A candidate you proposed withdrew from "Germany, 10 Welders"', requirementSubmissionsPath("en", "manila", JOB)],
    ["submission_approved", { requirement_id: JOB, partner_name: "Manila Recruit", org_slug: "acme", to_partner: "true" }, company, "A candidate proposed by Manila Recruit was submitted for a workforce requirement", requirementSubmissionsPath("en", "acme", JOB)],
    ["submission_stage_changed", { requirement_id: JOB, title: "Hamburg welders", status: "rejected", org_slug: "manila" }, company, 'A candidate you submitted for "Hamburg welders" is now Not selected', requirementSubmissionsPath("en", "manila", JOB)],
    ["submission_stage_changed", {}, company, "The stage of a candidate you submitted for a workforce requirement changed", null],
    ["status_changed", { submission_id: JOB, job_title: "Hamburg welders", partner_name: "Manila Recruit", status: "offer" }, worker, "Your submission by Manila Recruit for Hamburg welders is now Offer", submissionPath("en", JOB)],
  ] as const)("%s reads as one sentence and opens its context page", (kind, payload, context, title, href) => {
    const presented = presentNotification({ kind, payload }, context);
    expect(presented.title).toBe(title);
    expect(presented.href).toBe(href);
    expect(presented.kindLabel.length).toBeGreaterThan(0);
  });

  it("files a change or the closing of a requirement under Responses for a partner that responded, as from the marketplace, and under Invitations otherwise", () => {
    const label = (kind: string, payload: Record<string, unknown>) => presentNotification({ kind, payload }, company).kindLabel;
    expect(label("requirement_changed", { response_id: APP, changed_fields: ["start_date"], org_slug: "manila" })).toBe("Responses");
    expect(label("requirement_closed", { response_id: APP, close_reason: "filled", org_slug: "manila" })).toBe("Responses");
    expect(label("requirement_changed", { invitation_id: APP, changed_fields: ["start_date"], org_slug: "manila" })).toBe("Invitations");
    expect(label("requirement_closed", { invitation_id: APP, org_slug: "manila" })).toBe("Invitations");
  });

  it("offers a reporter whose report was dismissed the Complaints and Dispute Process, and only then", () => {
    const dismissed = presentNotification({ kind: "moderation_decision", payload: { reference: "R-000124", outcome: "dismissed" } }, worker);
    expect(dismissed.href).toBe(myReportsPath("en"));
    expect(dismissed.secondary).toEqual({
      lead: "If you disagree with this outcome, see the",
      label: "Complaints and Dispute Process",
      href: "/en/legal/complaints-and-dispute-process",
    });
    const actioned = presentNotification({ kind: "moderation_decision", payload: { reference: "R-000123", outcome: "actioned" } }, worker);
    expect(actioned.secondary).toBeUndefined();
  });

  it("falls back to a neutral sentence without a link when the ids are missing", () => {
    expect(presentNotification({ kind: "application_received", payload: {} }, company)).toEqual({
      title: "New application for your vacancy",
      kindLabel: "New application",
      href: null,
    });
    expect(presentNotification({ kind: "status_changed", payload: { status: "<script>" } }, worker).title).toBe(
      "There is an update on your application for your application",
    );
  });

  it("shows only text values of the payload", () => {
    const presented = presentNotification(
      { kind: "vacancy_hidden", payload: { job_title: { html: "<b>x</b>" }, job_id: JOB, org_slug: ["acme"] } },
      company,
    );
    expect(presented).toEqual({ title: "A vacancy was hidden by moderation", kindLabel: "Moderation", href: null });
  });

  it("shows a kind of a later release without failing", () => {
    expect(presentNotification({ kind: "new_message", payload: { submission_id: APP } }, company)).toEqual({
      title: "You have a new notification",
      kindLabel: "Notification",
      href: null,
    });
  });

  it("names the bell with the unread count (AC9)", () => {
    expect(bellLabel(4)).toBe("Notifications, 4 unread");
    expect(bellLabel(1)).toBe("Notifications, 1 unread");
    expect(bellLabel(0)).toBe("Notifications");
    expect(badgeText(7)).toBe("7");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
  });
});
