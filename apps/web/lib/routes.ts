import type { Database } from "@chara-pinnacle/db-types";
import type { ApplicantListParams } from "@/lib/validation/applicant-list";
import type { SubmissionListParams } from "@/lib/validation/submission-pipeline";

type AccountKind = Database["public"]["Enums"]["account_kind"];
type ApplicationStatus = Database["public"]["Enums"]["application_status"];

// Recruitment and staffing companies are company accounts too: their dashboards follow the type of the organisation
// (FR-R3, FR-R4), and the first segment of an account kind is its home.
export const dashboardSegments = {
  worker: "worker",
  employer: "company",
  recruitment: "company",
  staffing: "company",
} as const satisfies Record<string, AccountKind>;

export type DashboardSegment = keyof typeof dashboardSegments;

export function isDashboardSegment(value: string): value is DashboardSegment {
  return Object.hasOwn(dashboardSegments, value);
}

export function onboardingPath(lang: string, step?: "security" | "welcome"): string {
  return step ? `/${lang}/onboarding/${step}` : `/${lang}/onboarding`;
}

// The Where you serve step of partner onboarding, reopened after it was done (FR-K1).
export function whereYouServePath(lang: string): string {
  return `${onboardingPath(lang)}?step=where-you-serve`;
}

// The What you offer part of the step Where you serve, reopened after it was done (FR-K2).
export function whatYouOfferPath(lang: string): string {
  return `${onboardingPath(lang)}?step=what-you-offer`;
}

// A step of partner onboarding by its address (FR-J1): Ready, open once every earlier step is done, and the company
// details and Commitments, reopened after they were done (staff may ask for more information about them, FR-J4).
export function partnerStepPath(lang: string, step: "ready" | "company" | "commitments"): string {
  return `${onboardingPath(lang)}?step=${step}`;
}

// A user whose account kind is not committed yet still has the onboarding step to finish.
export function homePath(lang: string, accountKind: AccountKind | null): string {
  const segment = Object.entries(dashboardSegments).find(([, kind]) => kind === accountKind)?.[0];
  return segment ? `/${lang}/dashboard/${segment}` : onboardingPath(lang);
}

// The dashboard of an employer; without a slug it is the one of the first organization of the user.
export function employerDashboardPath(lang: string, slug?: string): string {
  return companyDashboardPath(lang, "employer", slug);
}

// The dashboard of a company for its segment (employer, recruitment or staffing), optionally of one organisation.
export function companyDashboardPath(lang: string, segment: "employer" | "recruitment" | "staffing", slug?: string): string {
  const path = `/${lang}/dashboard/${segment}`;
  return slug ? `${path}?org=${encodeURIComponent(slug)}` : path;
}

// The sign-up page, optionally with the account type preselected (the person can still change it).
export function signUpPath(lang: string, kind?: "worker" | "company" | "recruitment_company" | "staffing_company"): string {
  return kind ? `/${lang}/signup?kind=${kind}` : `/${lang}/signup`;
}

export function mfaPath(lang: string, next?: string): string {
  return next && next !== "/" ? `/${lang}/mfa?next=${encodeURIComponent(next)}` : `/${lang}/mfa`;
}

export function settingsPath(lang: string): string {
  return `/${lang}/settings`;
}

// The copy of a user's own data (FR-S3 AC8).
export function dataExportPath(lang: string): string {
  return `${settingsPath(lang)}/data-export`;
}

// The organisation is carried so that the header of an employer in several organisations stays on the one they work in.
export function notificationSettingsPath(lang: string, orgSlug?: string): string {
  const path = `${settingsPath(lang)}/notifications`;
  return orgSlug ? `${path}?org=${encodeURIComponent(orgSlug)}` : path;
}

// The in-app notifications, optionally from a keyset cursor on.
export function notificationsPath(lang: string, cursor?: string): string {
  return cursor ? `/${lang}/notifications?cursor=${encodeURIComponent(cursor)}` : `/${lang}/notifications`;
}

type JobStatus = Database["public"]["Enums"]["job_status"];

// The list of the vacancies of an organisation, optionally of one status, optionally from a keyset cursor on.
export function jobsPath(lang: string, slug: string, { status, after }: { status?: JobStatus | null; after?: string } = {}): string {
  const query = new URLSearchParams();
  if (status) query.set("status", status);
  if (after) query.set("after", after);
  const text = query.toString();
  return text ? `/${lang}/org/${slug}/jobs?${text}` : `/${lang}/org/${slug}/jobs`;
}

export function jobPath(lang: string, slug: string, id: string): string {
  return `${jobsPath(lang, slug)}/${id}`;
}

export function billingPath(lang: string, slug: string): string {
  return `/${lang}/org/${slug}/billing`;
}

export function organizationProfilePath(lang: string, slug: string): string {
  return `/${lang}/org/${slug}/profile`;
}

// The workforce profile of a recruitment or staffing company (FR-K1): where it serves.
export function workforceProfilePath(lang: string, slug: string): string {
  return `/${lang}/org/${slug}/workforce-profile`;
}

// How the members of a partner see their public profile, also before it is public (FR-K4 AC2).
export function workforceProfilePreviewPath(lang: string, slug: string): string {
  return `${workforceProfilePath(lang, slug)}/preview`;
}

// The public profile of a listed recruitment or staffing company (FR-K4).
export function partnerProfilePath(lang: string, slug: string): string {
  return `/${lang}/partners/${slug}`;
}

// The profile opened from a page of one of the viewer's employers: Invite offers that employer first (FR-O1).
export function partnerProfileForPath(lang: string, slug: string, forSlug: string): string {
  return `${partnerProfilePath(lang, slug)}?for=${encodeURIComponent(forSlug)}`;
}

// The public company page of an employer (FR-K5).
export function companyPagePath(lang: string, slug: string): string {
  return `/${lang}/companies/${slug}`;
}

// The workforce requirements of an employer (FR-M1), optionally from a keyset cursor on.
export function requirementsPath(lang: string, slug: string, after?: string): string {
  const path = `/${lang}/org/${slug}/requirements`;
  return after ? `${path}?after=${encodeURIComponent(after)}` : path;
}

export function requirementPath(lang: string, slug: string, id: string): string {
  return `${requirementsPath(lang, slug)}/${id}`;
}

// The invitations of one requirement, as its employer follows them (FR-O1).
export function requirementInvitationsPath(lang: string, slug: string, id: string): string {
  return `${requirementPath(lang, slug, id)}/invitations`;
}

// The responses of partners to one requirement, as its employer reads them (FR-O2), and one of them.
export function requirementResponsesPath(lang: string, slug: string, id: string): string {
  return `${requirementPath(lang, slug, id)}/responses`;
}

export function requirementResponsePath(lang: string, slug: string, id: string, responseId: string): string {
  return `${requirementResponsesPath(lang, slug, id)}/${responseId}`;
}

// The candidates submitted for one requirement: the partner's own and the employer's (FR-O4, FR-O5).
export function requirementSubmissionsPath(lang: string, slug: string, id: string, cursor?: string): string {
  const path = `${requirementPath(lang, slug, id)}/submissions`;
  return cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;
}

// The partner's form to ask a candidate's permission to submit them for one requirement (FR-O4 step Request).
export function newSubmissionPath(lang: string, slug: string, id: string): string {
  return `${requirementSubmissionsPath(lang, slug, id)}/new`;
}

// Every candidate the partner asked to submit, newest first (FR-O4 AC12).
export function partnerSubmissionsPath(lang: string, slug: string, cursor?: string): string {
  const path = `/${lang}/org/${slug}/submissions`;
  return cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;
}

// The responses to one requirement side by side, with the decisions (FR-O3).
export function requirementResponsesComparePath(lang: string, slug: string, id: string): string {
  return `${requirementResponsesPath(lang, slug, id)}/compare`;
}

// The partners suggested for one requirement (FR-M3).
export function requirementPartnersPath(lang: string, slug: string, id: string): string {
  return `${requirementPath(lang, slug, id)}/partners`;
}

// The job order marketplace of a recruitment or staffing company (FR-N1), with the query of its filters and page.
export function jobOrdersPath(lang: string, slug: string, query = ""): string {
  const path = `/${lang}/org/${slug}/job-orders`;
  return query === "" ? path : `${path}?${query}`;
}

export function jobOrderPath(lang: string, slug: string, id: string): string {
  return `${jobOrdersPath(lang, slug)}/${id}`;
}

// Find Employers of a recruitment or staffing company (FR-L3), with the query of its filters and page.
export function findEmployersPath(lang: string, slug: string, query = ""): string {
  const path = `/${lang}/org/${slug}/find-employers`;
  return query === "" ? path : `${path}?${query}`;
}

// The response form for a job order of the marketplace (FR-N2 step Respond, FR-O2).
export function jobOrderRespondPath(lang: string, slug: string, id: string): string {
  return `${jobOrderPath(lang, slug, id)}/respond`;
}

// The invitations a recruitment or staffing company received (FR-O1), with the query of the status filter and the page,
// and one of them.
export function invitationsPath(lang: string, slug: string, query = ""): string {
  const path = `/${lang}/org/${slug}/invitations`;
  return query === "" ? path : `${path}?${query}`;
}

export function invitationPath(lang: string, slug: string, id: string): string {
  return `${invitationsPath(lang, slug)}/${id}`;
}

// The response form for the requirement of an invitation (FR-O1 AC8: Accept opens it).
export function invitationRespondPath(lang: string, slug: string, id: string): string {
  return `${invitationPath(lang, slug, id)}/respond`;
}

// The responses a recruitment or staffing company sent (FR-O2), one of them, and its edit form.
export function responsesPath(lang: string, slug: string, cursor?: string): string {
  const path = `/${lang}/org/${slug}/responses`;
  return cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;
}

export function responsePath(lang: string, slug: string, id: string): string {
  return `${responsesPath(lang, slug)}/${id}`;
}

export function responseEditPath(lang: string, slug: string, id: string): string {
  return `${responsePath(lang, slug, id)}/edit`;
}

// The partners an employer saved (FR-L4), optionally from a keyset cursor on.
export function savedPartnersPath(lang: string, slug: string, cursor?: string): string {
  const path = `/${lang}/org/${slug}/saved-partners`;
  return cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;
}

// The companies the signed-in user follows (FR-L4), optionally from a keyset cursor on.
export function followingPath(lang: string, cursor?: string): string {
  return cursor ? `/${lang}/following?cursor=${encodeURIComponent(cursor)}` : `/${lang}/following`;
}

// The login page, coming back to the page `next` afterwards.
export function loginPath(lang: string, next: string): string {
  return `/${lang}/login?next=${encodeURIComponent(next)}`;
}

export function membersPath(lang: string, slug: string): string {
  return `/${lang}/org/${slug}/members`;
}

export function applyPath(lang: string, jobId: string): string {
  return `/${lang}/jobs/${jobId}/apply`;
}

export function applicationsPath(lang: string, { stage, page }: { stage?: ApplicationStatus | null; page?: number } = {}): string {
  const query = new URLSearchParams();
  if (stage) query.set("stage", stage);
  if (page && page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `/${lang}/applications?${text}` : `/${lang}/applications`;
}

export function applicationPath(lang: string, id: string): string {
  return `/${lang}/applications/${id}`;
}

// The candidate's submission requests and submissions (FR-O4), and one of them.
export function submissionsPath(lang: string): string {
  return `/${lang}/submissions`;
}

export function submissionPath(lang: string, id: string): string {
  return `${submissionsPath(lang)}/${id}`;
}

export function applicantPath(lang: string, slug: string, id: string): string {
  return `/${lang}/org/${slug}/applicants/${id}`;
}

// The list of the applicants of an organisation; a value that is the default of the page is left out of the address.
export function applicantsPath(lang: string, slug: string, params: Partial<ApplicantListParams> = {}): string {
  const { job, view, sort, dir, stage, page } = params;
  const query = new URLSearchParams();
  if (job) query.set("job", job);
  if (job && view === "board") query.set("view", "board");
  if ((sort && sort !== "applied") || dir === "asc") {
    query.set("sort", sort ?? "applied");
    query.set("dir", dir ?? "desc");
  }
  if (stage) query.set("stage", stage);
  if (page && page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `/${lang}/org/${slug}/applicants?${text}` : `/${lang}/org/${slug}/applicants`;
}

// The submitted candidates on the applicants page (FR-O5): of one requirement, or of every requirement with the source
// filter; a value that is the default of the page is left out of the address.
export function submissionPipelinePath(lang: string, slug: string, params: Partial<SubmissionListParams> = {}): string {
  const { requirement, view, stage, page } = params;
  const query = new URLSearchParams();
  if (requirement) query.set("requirement", requirement);
  else query.set("source", "submissions");
  if (requirement && view === "board") query.set("view", "board");
  if (stage) query.set("stage", stage);
  if (page && page > 1) query.set("page", String(page));
  return `/${lang}/org/${slug}/applicants?${query.toString()}`;
}

export function employerSubmissionPath(lang: string, slug: string, id: string): string {
  return `/${lang}/org/${slug}/applicants/submissions/${id}`;
}

export function applicantsExportPath(lang: string, slug: string): string {
  return `/${lang}/org/${slug}/applicants/export`;
}

export function adminPath(lang: string, segment = ""): string {
  return segment ? `/${lang}/admin/${segment}` : `/${lang}/admin`;
}

// The form to report a vacancy, a company or a page (and the note on candidate profiles), with the target already named when the link comes from a page that
// knows it (a vacancy by its id, a page by its path).
const reportTargetParams = { job: "job", company: "job", profile: "job", content: "path", partner_profile: "partner" } as const;

// The report form of a kind of target, with the target when the page knows it (the vacancy, the path or the slug of a
// partner profile) and a category to preselect, as "Report a fee demand" does.
export function reportPath(
  lang: string,
  type: keyof typeof reportTargetParams,
  target?: string,
  category?: Database["public"]["Enums"]["report_category"],
): string {
  const query = new URLSearchParams({ type });
  if (target) query.set(reportTargetParams[type], target);
  if (category) query.set("category", category);
  return `/${lang}/report?${query.toString()}`;
}

// A member reports an applicant of the organisation from the applicant page.
export function applicantReportPath(lang: string, slug: string, id: string): string {
  return `${applicantPath(lang, slug, id)}/report`;
}

export function myReportsPath(lang: string, after?: { at: string; id: number }): string {
  if (!after) return `/${lang}/reports`;
  return `/${lang}/reports?${new URLSearchParams({ afterAt: after.at, afterId: String(after.id) }).toString()}`;
}

// The moderation decisions on the caller's organisations and their appeals (FR-S1), and one decision with its appeal.
export function appealsPath(lang: string): string {
  return `/${lang}/appeals`;
}

export function appealPath(lang: string, decision: number): string {
  return `${appealsPath(lang)}/${decision}`;
}
