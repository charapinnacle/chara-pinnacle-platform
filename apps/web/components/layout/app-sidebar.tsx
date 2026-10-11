"use client";

import {
  Bookmark,
  BriefcaseBusiness,
  CreditCard,
  Flag,
  IdCard,
  LayoutDashboard,
  type LucideIcon,
  Search,
  Send,
  Settings,
  Users,
  UsersRound,
} from "lucide-react";
import { OrganizationList, useAppNavigation, type AppNavProps } from "@/components/layout/app-nav";
import { MenuDisclosure } from "@/components/layout/menu-disclosure";
import { SidebarIdentity } from "@/components/layout/sidebar-identity";
import { SidebarLink } from "@/components/layout/sidebar-link";
import { isCurrent, type NavIcon } from "@/lib/app/navigation";

const icons: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  jobs: Search,
  saved: Bookmark,
  applications: Send,
  passport: IdCard,
  organisation: LayoutDashboard,
  vacancies: BriefcaseBusiness,
  applicants: Users,
  team: UsersRound,
  billing: CreditCard,
  reports: Flag,
  settings: Settings,
};

// The sidebar of the signed-in area from 1024 px: the same links as the header (the header hides its own there), and at
// the foot the organisation worked in, which is the switcher for a person in several, or the candidate's account.
export function AppSidebar(props: AppNavProps) {
  const { lang, email, organizations } = props;
  const { pathname, organization, links, switcher, account } = useAppNavigation(props);

  return (
    <>
      {links.length > 0 ? (
        <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <ul className="grid gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <SidebarLink href={link.href} label={link.label} icon={icons[link.icon]} current={isCurrent(pathname, link)} />
              </li>
            ))}
          </ul>
        </nav>
      ) : (
        <div className="flex-1" />
      )}
      <div className="border-t p-3">
        {switcher ? (
          <MenuDisclosure
            placement="above"
            label={<SidebarIdentity title={switcher.displayName} detail={switcher.roleLabel} />}
            className="w-full"
            buttonClassName="w-full max-w-none px-2 py-1.5 text-start"
          >
            <OrganizationList lang={lang} organizations={organizations} current={switcher.slug} />
          </MenuDisclosure>
        ) : organization ? (
          <SidebarIdentity title={organization.displayName} detail={organization.roleLabel} className="px-2 py-1.5" />
        ) : email ? (
          <SidebarIdentity title={email} detail={account.roleLabel} className="px-2 py-1.5" />
        ) : null}
      </div>
    </>
  );
}
