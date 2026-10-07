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

// A user whose account kind is not committed yet still has the onboarding step to finish.
export function homePath(lang: string, accountKind: AccountKind | null): string {
  const segment = Object.entries(dashboardSegments).find(([, kind]) => kind === accountKind)?.[0];
  return segment ? `/${lang}/dashboard/${segment}` : `/${lang}/onboarding`;
}

export function mfaPath(lang: string, next?: string): string {
  return next && next !== "/" ? `/${lang}/mfa?next=${encodeURIComponent(next)}` : `/${lang}/mfa`;
}

export function settingsPath(lang: string): string {
  return `/${lang}/settings`;
}

export function jobsPath(lang: string, slug: string): string {
  return `/${lang}/org/${slug}/jobs`;
}

export function jobPath(lang: string, slug: string, id: string): string {
  return `${jobsPath(lang, slug)}/${id}`;
}

export function billingPath(lang: string, slug: string): string {
  return `/${lang}/org/${slug}/billing`;
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
