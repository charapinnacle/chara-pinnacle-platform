import { CircleUser } from "lucide-react";
import { LogoutButton } from "@/components/auth/logout-button";
import { MenuDisclosure } from "@/components/layout/menu-disclosure";
import { NavLink } from "@/components/layout/nav-link";
import type { NavLink as Entry } from "@/lib/app/navigation";

type AccountPanelProps = { email: string | null; roleLabel?: string; links: readonly Entry[] };

// Who is signed in, the pages that belong to the person rather than to the organisation, and the way out.
export function AccountPanel({ email, roleLabel, links }: AccountPanelProps) {
  return (
    <div className="grid gap-1">
      {email ? (
        <div className="px-3 py-2">
          <p className="font-medium [overflow-wrap:anywhere]">{email}</p>
          {roleLabel ? <p className="text-small text-muted-foreground">{roleLabel}</p> : null}
        </div>
      ) : null}
      {links.length > 0 ? (
        <ul className="grid gap-1">
          {links.map((link) => (
            <li key={link.href}>
              <NavLink link={link} />
            </li>
          ))}
        </ul>
      ) : null}
      <LogoutButton className="mt-1 w-full" />
    </div>
  );
}

export function AccountMenu({ className, ...panel }: AccountPanelProps & { className?: string }) {
  return (
    <MenuDisclosure label="Account" icon={<CircleUser aria-hidden className="size-5" />} className={className}>
      <AccountPanel {...panel} />
    </MenuDisclosure>
  );
}
