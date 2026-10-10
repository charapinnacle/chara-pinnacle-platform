"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AccountMenu, AccountPanel } from "@/components/layout/account-panel";
import { HeaderMenu } from "@/components/layout/header-menu";
import { MenuDisclosure } from "@/components/layout/menu-disclosure";
import { NavLink } from "@/components/layout/nav-link";
import { accountLinks, currentOrganization, isGatePage, organizationLinks, workerLinks, type NavOrganization } from "@/lib/app/navigation";
import { employerDashboardPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

export type AppNavProps = {
  lang: string;
  email: string | null;
  accountKind: "worker" | "company" | null;
  organizations: readonly NavOrganization[];
};

// What the header and the sidebar offer, for who is signed in: a candidate, or the role in the organisation named by the
// address.
export function useAppNavigation({ lang, email, accountKind, organizations }: AppNavProps) {
  const pathname = usePathname();
  const orgParam = useSearchParams().get("org");
  const organization = accountKind === "company" ? currentOrganization(lang, pathname, orgParam, organizations) : undefined;
  const offered = accountKind === "worker" ? workerLinks(lang) : organization ? organizationLinks(lang, organization) : [];
  const links = isGatePage(lang, pathname) ? [] : offered;
  const roleLabel = accountKind === "worker" ? "Worker" : accountKind === "company" ? (organization?.roleLabel ?? "Employer") : undefined;
  const switcher = organizations.length > 1 ? organization : undefined;
  const account = { email, roleLabel, links: accountKind ? accountLinks(lang, accountKind, switcher?.slug) : [] };
  return { pathname, organization, links, switcher, account };
}

export function OrganizationList({ lang, organizations, current }: { lang: string; organizations: readonly NavOrganization[]; current: string | undefined }) {
  return (
    <ul className="grid gap-1">
      {organizations.map(({ slug, displayName }) => (
        <li key={slug}>
          <Link
            href={employerDashboardPath(lang, slug)}
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

// The header of the signed-in area. The menu panel is the mobile menu below 768 px (visible without JavaScript) and the
// row of links with the organisation switcher and the account menu above; from 1024 px the sidebar has the links and the
// switcher, and the header keeps the account menu.
export function AppNav(props: AppNavProps) {
  const { lang, organizations } = props;
  const { links, switcher, account } = useAppNavigation(props);

  return (
    <HeaderMenu>
      <div className="grid gap-2 md:flex md:items-center md:gap-1">
        {links.length > 0 ? (
          <nav aria-label="Main" className="lg:hidden">
            <ul className="grid md:flex md:items-center md:gap-1">
              {links.map((link) => (
                <li key={link.href}>
                  <NavLink link={link} />
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {switcher ? (
          <>
            <MenuDisclosure label={switcher.displayName} className="hidden md:block lg:hidden">
              <OrganizationList lang={lang} organizations={organizations} current={switcher.slug} />
            </MenuDisclosure>
            <div className="grid gap-1 border-t pt-2 md:hidden">
              <p className="px-3 text-small text-muted-foreground">Your organisations</p>
              <OrganizationList lang={lang} organizations={organizations} current={switcher.slug} />
            </div>
          </>
        ) : null}
        <AccountMenu {...account} className="hidden md:block" />
        <div className="border-t pt-2 md:hidden">
          <AccountPanel {...account} />
        </div>
      </div>
    </HeaderMenu>
  );
}
