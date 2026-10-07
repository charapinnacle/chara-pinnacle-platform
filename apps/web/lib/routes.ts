import type { Database } from "@chara-pinnacle/db-types";

type AccountKind = Database["public"]["Enums"]["account_kind"];

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

export function applicationsPath(lang: string, cursor?: string): string {
  return cursor ? `/${lang}/applications?cursor=${encodeURIComponent(cursor)}` : `/${lang}/applications`;
}

export function applicationPath(lang: string, id: string): string {
  return `/${lang}/applications/${id}`;
}
