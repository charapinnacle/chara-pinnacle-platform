import { describe, expect, it } from "vitest";
import { isNotificationKind } from "@/emails/index";
import { badgeText, bellLabel } from "@/lib/notifications/bell";
import { presentedKinds, presentNotification } from "@/lib/notifications/present";
import {
  applicantPath,
  applicationPath,
  billingPath,
  companyPagePath,
  employerDashboardPath,
  homePath,
  jobPath,
  mfaPath,
  myReportsPath,
  partnerStepPath,
  settingsPath,
  whereYouServePath,
  workforceProfilePath,
} from "@/lib/routes";

const APP = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const company = { lang: "en", accountKind: "company" } as const;
const worker = { lang: "en", accountKind: "worker" } as const;

// Kinds whose rows have no user (sent to an address) or that the in-app list never shows (DATA_MODEL.md section 9).
const NOT_LISTED = ["deletion_completed", "member_invitation", "erasure_paused"];

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
    ["account_reinstated", {}, worker, "Your account was reinstated", homePath("en", "worker")],
    ["account_exists", {}, company, "Someone tried to sign up with your email address", null],
    ["partner_approved", { org_name: "Manila Recruit", org_slug: "manila" }, company, "Manila Recruit is now listed in the partner directories", employerDashboardPath("en")],
    ["partner_info_requested", { info_step: "company", reason: "x" }, company, "Our team needs more information about your company details", partnerStepPath("en", "company")],
    ["partner_info_requested", { info_step: "where_you_serve" }, company, "Our team needs more information about where you serve and what you offer", whereYouServePath("en")],
    ["partner_info_requested", { info_step: "commitments" }, company, "Our team needs more information about the employer-pays commitment", partnerStepPath("en", "commitments")],
    ["partner_info_requested", { info_step: "security" }, company, "Our team needs more information about your company", partnerStepPath("en", "ready")],
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
    ["moderation_decision", { target_type: "partner_profile", title: "Manila Recruit", org_slug: "manila", decision: "hide", reasons: "x" }, company, "Manila Recruit was hidden by moderation", `${workforceProfilePath("en", "manila")}#moderation-heading`],
    ["moderation_decision", { target_type: "partner_profile", title: "Manila Recruit", org_slug: "manila", decision: "unhide" }, company, "Manila Recruit is shown again", workforceProfilePath("en", "manila")],
    ["moderation_decision", { reference: "R-000123", outcome: "actioned" }, worker, "Your report R-000123 was closed", myReportsPath("en")],
    ["moderation_decision", {}, company, "Your partner profile was hidden by moderation", null],
  ] as const)("%s reads as one sentence and opens its context page", (kind, payload, context, title, href) => {
    const presented = presentNotification({ kind, payload }, context);
    expect(presented.title).toBe(title);
    expect(presented.href).toBe(href);
    expect(presented.kindLabel.length).toBeGreaterThan(0);
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
    expect(presentNotification({ kind: "invitation_received", payload: { requirement_id: APP } }, company)).toEqual({
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
