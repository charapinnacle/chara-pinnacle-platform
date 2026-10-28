import {
  applicantsPath,
  applicationsPath,
  billingPath,
  companyDashboardPath,
  employerDashboardPath,
  homePath,
  invitationsPath,
  jobsPath,
  membersPath,
  myReportsPath,
  notificationSettingsPath,
  requirementsPath,
  settingsPath,
  workforceProfilePath,
} from "@/lib/routes";
import type { MemberRole } from "@/lib/validation/team";

export type NavIcon =
  | "dashboard"
  | "jobs"
  | "saved"
  | "applications"
  | "passport"
  | "organisation"
  | "vacancies"
  | "applicants"
  | "team"
  | "workforce"
  | "requirements"
  | "invitations"
  | "billing"
  | "reports"
  | "settings";

// match is the address the link stands for: the page and everything below it, or only the page when exact is set. icon
// names the picture the sidebar draws next to the label.
export type NavLink = { label: string; href: string; match: string; icon: NavIcon; exact?: true };

export type Crumb = { label: string; href?: string };

export type NavOrganization = {
  slug: string;
  displayName: string;
  role: MemberRole;
  roleLabel: string;
  suspended: boolean;
  // Set for a recruitment or staffing company: the segment of its dashboard (FR-R3, FR-R4).
  partnerSegment?: "recruitment" | "staffing";
  // Set while release 2b is on: the workforce requirements of an employer, the invitations of a partner (FR-O1).
  jobOrders?: true;
};

// The pages of a candidate. Each of them asks for the candidate itself; the list only decides what is offered.
export function workerLinks(lang: string): NavLink[] {
  const dashboard = homePath(lang, "worker");
  return [
    { label: "Dashboard", href: dashboard, match: dashboard, icon: "dashboard" },
    { label: "Find jobs", href: `/${lang}/jobs`, match: `/${lang}/jobs`, icon: "jobs" },
    { label: "Saved", href: `/${lang}/saved`, match: `/${lang}/saved`, icon: "saved" },
    { label: "Applications", href: applicationsPath(lang), match: `/${lang}/applications`, icon: "applications" },
    { label: "Passport", href: `/${lang}/passport`, match: `/${lang}/passport`, icon: "passport" },
  ];
}

// The pages of one organisation. Billing is for owners and administrators, as the page itself requires, and a suspended
// organisation has none of them: each answers with a notice that it is suspended. A recruitment or staffing company has
// its dashboard, its workforce profile and its team instead of vacancies and applicants (FR-J1, FR-K1). While release 2b
// is on, an employer has its workforce requirements, where it follows its invitations, and a partner the invitations it
// received (FR-O1).
export function organizationLinks(
  lang: string,
  { slug, role, suspended, partnerSegment, jobOrders }: Pick<NavOrganization, "slug" | "role" | "suspended" | "partnerSegment" | "jobOrders">,
): NavLink[] {
  if (suspended) return [];
  const team: NavLink = { label: "Team", href: membersPath(lang, slug), match: membersPath(lang, slug), icon: "team" };
  const links: NavLink[] = partnerSegment
    ? [
        {
          label: "Organisation",
          href: companyDashboardPath(lang, partnerSegment, slug),
          match: `/${lang}/dashboard/${partnerSegment}`,
          icon: "organisation",
        },
        { label: "Workforce profile", href: workforceProfilePath(lang, slug), match: workforceProfilePath(lang, slug), icon: "workforce" },
        ...(jobOrders
          ? [{ label: "Invitations", href: invitationsPath(lang, slug), match: invitationsPath(lang, slug), icon: "invitations" } as const]
          : []),
        team,
      ]
    : [
        { label: "Organisation", href: employerDashboardPath(lang, slug), match: `/${lang}/dashboard/employer`, icon: "organisation" },
        { label: "Vacancies", href: jobsPath(lang, slug), match: `/${lang}/org/${slug}/jobs`, icon: "vacancies" },
        { label: "Applicants", href: applicantsPath(lang, slug), match: `/${lang}/org/${slug}/applicants`, icon: "applicants" },
        ...(jobOrders
          ? [{ label: "Requirements", href: requirementsPath(lang, slug), match: requirementsPath(lang, slug), icon: "requirements" } as const]
          : []),
        team,
      ];
  if (role !== "member") links.push({ label: "Billing", href: billingPath(lang, slug), match: billingPath(lang, slug), icon: "billing" });
  return links;
}

// What belongs to the person rather than to the organisation. A candidate edits the profile (the passport) and has the
// settings (account deletion, with the way to the notification settings); an employer has Settings, which are the
// notification settings (an employer is sent away from the account settings page, which is for candidates). orgSlug is
// given to a person in several organisations, so that the page keeps the header of the one they work in.
export function accountLinks(lang: string, accountKind: "worker" | "company", orgSlug?: string): NavLink[] {
  const reports: NavLink = { label: "My reports", href: myReportsPath(lang), match: myReportsPath(lang), icon: "reports" };
  if (accountKind === "worker") {
    return [
      { label: "Edit profile", href: `/${lang}/passport`, match: `/${lang}/passport`, icon: "passport" },
      { label: "Settings", href: settingsPath(lang), match: settingsPath(lang), icon: "settings", exact: true },
      reports,
    ];
  }
  return [{ label: "Settings", href: notificationSettingsPath(lang, orgSlug), match: notificationSettingsPath(lang), icon: "settings" }, reports];
}

// The consent page exists to finish a step that every other page waits for, so the header offers no links there (onboarding
// has a layout of its own without the header).
export function isGatePage(lang: string, pathname: string): boolean {
  return pathname === `/${lang}/consent`;
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
