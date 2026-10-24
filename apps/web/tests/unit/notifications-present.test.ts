import { describe, expect, it } from "vitest";
import { isNotificationKind } from "@/emails/index";
import { badgeText, bellLabel } from "@/lib/notifications/bell";
import { presentedKinds, presentNotification } from "@/lib/notifications/present";
import { applicantPath, applicationPath, billingPath, homePath, jobPath, mfaPath, settingsPath } from "@/lib/routes";

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
