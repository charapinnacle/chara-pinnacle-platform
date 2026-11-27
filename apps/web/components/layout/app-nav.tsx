"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AccountMenu, AccountPanel } from "@/components/layout/account-panel";
import { HeaderMenu } from "@/components/layout/header-menu";
import { NavLink } from "@/components/layout/nav-link";
import { MessagesBadge } from "@/components/messaging/messages-badge";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { accountLinks, currentOrganization, isGatePage, organizationLinks, workerLinks, type NavOrganization } from "@/lib/app/navigation";
import type { UnreadMessages } from "@/lib/messaging/thread";
import { companyDashboardPath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { messagesPath } from "@/lib/routes";

export type AppNavProps = {
  lang: string;
  email: string | null;
  accountKind: "worker" | "company" | null;
  organizations: readonly NavOrganization[];
  // The bell of the in-app notifications, while they are released and the person is a worker or a company user.
  notifications?: { userId: string; initialUnread: number } | null;
  // Set for a candidate while candidate submissions are released (FR-O4).
  submissions?: boolean;
  // Set for a candidate while Find Workers is released (FR-Q3).
  contactRequests?: boolean;
  // Set for a candidate while release 2c is on (FR-P1).
  messages?: boolean;
  // The unread messages of the header badge while release 2c is on (FR-P4), with the id of each organisation by slug.
  unreadMessages?: { userId: string; initial: UnreadMessages[]; organizationIds: Readonly<Record<string, string>> } | null;
};

// What the header and the sidebar offer, for who is signed in: a candidate, or the role in the organisation named by the
// address.
export function useAppNavigation({ lang, email, accountKind, organizations, submissions, contactRequests, messages }: AppNavProps) {
  const pathname = usePathname();
  const orgParam = useSearchParams().get("org");
  const organization = accountKind === "company" ? currentOrganization(lang, pathname, orgParam, organizations) : undefined;
  const offered = accountKind === "worker" ? workerLinks(lang, { submissions, contactRequests, messaging: messages }) : organization ? organizationLinks(lang, organization) : [];
  const links = isGatePage(lang, pathname) ? [] : offered;
  const roleLabel = accountKind === "worker" ? "Worker" : accountKind === "company" ? (organization?.roleLabel ?? "Company account") : undefined;
  const switcher = organizations.length > 1 ? organization : undefined;
  const account = { email, roleLabel, links: accountKind ? accountLinks(lang, accountKind, switcher?.slug, organization && organization.role !== "member" ? organization.slug : undefined) : [] };
  return { pathname, organization, links, switcher, account };
}

export function OrganizationList({ lang, organizations, current }: { lang: string; organizations: readonly NavOrganization[]; current: string | undefined }) {
  return (
    <ul className="grid gap-1">
      {organizations.map(({ slug, displayName, partnerSegment }) => (
        <li key={slug}>
          <Link
            href={companyDashboardPath(lang, partnerSegment ?? "employer", slug)}
            aria-current={slug === current ? "true" : undefined}
            className={cn(
              "inline-flex min-h-11 w-full items-center rounded-lg px-3 text-small font-medium [overflow-wrap:anywhere] transition-colors duration-150 hover:bg-secondary",
              slug === current && "bg-accent text-accent-foreground",
            )}
          >
            {displayName}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// The header of the signed-in area. Below 1024 px the links, the organisations and the account are in the menu panel
// (visible without JavaScript), since a partner's row of links does not fit next to the account menu on a tablet; from
// 1024 px the sidebar has the links and the switcher, and the header keeps the account menu.
export function AppNav(props: AppNavProps) {
  const { lang, organizations, notifications, unreadMessages } = props;
  const { organization, links, switcher, account } = useAppNavigation(props);
  // A candidate's Messages is in the menu; an organisation's conversations are only behind this button, not in the sidebar.
  const messagesHref =
    links.find((link) => link.icon === "messages")?.href ?? (organization?.messaging ? messagesPath(lang, organization.slug) : undefined);
  const badge =
    unreadMessages && messagesHref ? (
      <MessagesBadge
        href={messagesHref}
        userId={unreadMessages.userId}
        initial={unreadMessages.initial}
        organizationId={organization ? (unreadMessages.organizationIds[organization.slug] ?? null) : null}
      />
    ) : null;
  const bell = notifications ? <NotificationBell lang={lang} {...notifications} /> : null;

  return (
    <HeaderMenu
      actions={
        badge || bell ? (
          <>
            {badge}
            {bell}
          </>
        ) : null
      }
    >
      <div className="grid gap-2 lg:flex lg:items-center lg:gap-1">
        {links.length > 0 ? (
          <nav aria-label="Main" className="lg:hidden">
            <ul className="grid">
              {links.map((link) => (
                <li key={link.href}>
                  <NavLink link={link} />
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {switcher ? (
          <div className="grid gap-1 border-t pt-2 lg:hidden">
            <p className="px-3 text-small text-muted-foreground">Your organisations</p>
            <OrganizationList lang={lang} organizations={organizations} current={switcher.slug} />
          </div>
        ) : null}
        <AccountMenu {...account} className="hidden lg:block" />
        <div className="border-t pt-2 lg:hidden">
          <AccountPanel {...account} />
        </div>
      </div>
    </HeaderMenu>
  );
}
