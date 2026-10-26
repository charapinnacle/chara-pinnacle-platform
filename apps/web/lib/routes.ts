import type { Database } from "@chara-pinnacle/db-types";
import type { ApplicantListParams } from "@/lib/validation/applicant-list";

type AccountKind = Database["public"]["Enums"]["account_kind"];
type ApplicationStatus = Database["public"]["Enums"]["application_status"];

export const dashboardSegments = { worker: "worker", employer: "company" } as const satisfies Record<
  string,
  AccountKind
>;

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
  return slug ? `/${lang}/dashboard/employer?org=${encodeURIComponent(slug)}` : `/${lang}/dashboard/employer`;
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

export function applicantsExportPath(lang: string, slug: string): string {
  return `/${lang}/org/${slug}/applicants/export`;
}

export function adminPath(lang: string, segment = ""): string {
  return segment ? `/${lang}/admin/${segment}` : `/${lang}/admin`;
}

// The form to report a vacancy, a company or a page (and the note on candidate profiles), with the target already named when the link comes from a page that
// knows it (a vacancy by its id, a page by its path).
export function reportPath(lang: string, type: "job" | "company" | "profile" | "content", target?: string): string {
  const query = new URLSearchParams({ type });
  if (target) query.set(type === "content" ? "path" : "job", target);
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
