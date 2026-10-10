import {
  applicantsPath,
  applicationsPath,
  billingPath,
  employerDashboardPath,
  homePath,
  jobsPath,
  membersPath,
  notificationSettingsPath,
  settingsPath,
} from "@/lib/routes";
import type { MemberRole } from "@/lib/validation/team";

// match is the address the link stands for: the page and everything below it, or only the page when exact is set.
export type NavLink = { label: string; href: string; match: string; exact?: true };

export type Crumb = { label: string; href?: string };

export type NavOrganization = {
  slug: string;
  displayName: string;
  role: MemberRole;
  roleLabel: string;
  suspended: boolean;
};

// The pages of a candidate. Each of them asks for the candidate itself; the list only decides what is offered.
export function workerLinks(lang: string): NavLink[] {
  const dashboard = homePath(lang, "worker");
  return [
    { label: "Dashboard", href: dashboard, match: dashboard },
    { label: "Find jobs", href: `/${lang}/jobs`, match: `/${lang}/jobs` },
    { label: "Saved", href: `/${lang}/saved`, match: `/${lang}/saved` },
    { label: "Applications", href: applicationsPath(lang), match: `/${lang}/applications` },
    { label: "Passport", href: `/${lang}/passport`, match: `/${lang}/passport` },
  ];
}

// The pages of one organisation. Billing is for owners and administrators, as the page itself requires, and a suspended
// organisation has none of them: each answers with a notice that it is suspended.
export function organizationLinks(lang: string, { slug, role, suspended }: Pick<NavOrganization, "slug" | "role" | "suspended">): NavLink[] {
  if (suspended) return [];
  const links: NavLink[] = [
    { label: "Organisation", href: employerDashboardPath(lang, slug), match: `/${lang}/dashboard/employer` },
    { label: "Vacancies", href: jobsPath(lang, slug), match: `/${lang}/org/${slug}/jobs` },
    { label: "Applicants", href: applicantsPath(lang, slug), match: `/${lang}/org/${slug}/applicants` },
    { label: "Team", href: membersPath(lang, slug), match: membersPath(lang, slug) },
  ];
  if (role !== "member") links.push({ label: "Billing", href: billingPath(lang, slug), match: billingPath(lang, slug) });
  return links;
}

// Account deletion belongs to candidates (an employer is sent away from that page); the notification settings to everyone.
// orgSlug is given to a person in several organisations, so that the page keeps the header of the one they work in.
export function accountLinks(lang: string, accountKind: "worker" | "company", orgSlug?: string): NavLink[] {
  const notifications: NavLink = { label: "Notification settings", href: notificationSettingsPath(lang, orgSlug), match: notificationSettingsPath(lang) };
  if (accountKind !== "worker") return [notifications];
  return [{ label: "Settings", href: settingsPath(lang), match: settingsPath(lang), exact: true }, notifications];
}

// The onboarding and consent pages exist to finish a step that every other page waits for, so the header offers no links there.
export function isGatePage(lang: string, pathname: string): boolean {
  return pathname === `/${lang}/onboarding` || pathname === `/${lang}/consent`;
}

export function isCurrent(pathname: string, { match, exact }: Pick<NavLink, "match" | "exact">): boolean {
  return pathname === match || (!exact && pathname.startsWith(`${match}/`));
}

// The organisation a person is working in: the one named by the address (/org/<slug>/... or ?org=<slug>), else the first.
export function currentOrganization(
  lang: string,
  pathname: string,
  orgParam: string | null,
  organizations: readonly NavOrganization[],
): NavOrganization | undefined {
  const prefix = `/${lang}/org/`;
  const slug = pathname.startsWith(prefix) ? pathname.slice(prefix.length).split("/")[0] : orgParam;
  return organizations.find((organization) => organization.slug === slug) ?? organizations[0];
}

// The first item of every breadcrumb in an organisation: the organisation, which leads to its dashboard.
export function organizationCrumb(lang: string, { slug, displayName }: Pick<NavOrganization, "slug" | "displayName">): Crumb {
  return { label: displayName, href: employerDashboardPath(lang, slug) };
}
