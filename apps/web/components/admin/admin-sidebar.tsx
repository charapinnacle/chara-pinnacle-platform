"use client";

import { BarChart3, Building2, FileText, KeyRound, type LucideIcon, ScrollText, ShieldAlert, ShieldCheck, UserCog, Users, EyeOff } from "lucide-react";
import { usePathname } from "next/navigation";
import { SidebarIdentity } from "@/components/layout/sidebar-identity";
import { SidebarLink } from "@/components/layout/sidebar-link";
import type { adminEntries } from "@/lib/admin/navigation";

type Segment = (typeof adminEntries)[number]["segment"];

const icons: Record<Segment, LucideIcon> = {
  users: Users,
  organizations: Building2,
  statistics: BarChart3,
  legal: FileText,
  audit: ScrollText,
  staff: UserCog,
  "mfa-reset": KeyRound,
  moderation: EyeOff,
  suspensions: ShieldAlert,
};

type AdminSidebarProps = {
  entries: readonly { label: string; href: string; segment: Segment }[];
  email: string | null;
  roleLabel: string | undefined;
};

// The console navigation from 1024 px (below it AdminNav, a grid under the header), and the staff member at its foot.
export function AdminSidebar({ entries, email, roleLabel }: AdminSidebarProps) {
  const pathname = usePathname();
  return (
    <>
      {entries.length > 0 ? (
        <nav aria-label="Administration" className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <p className="px-3 pb-2 text-caption font-medium tracking-[0.08em] text-muted-foreground uppercase">Console</p>
          <ul className="grid gap-1">
            {entries.map(({ label, href, segment }) => (
              <li key={href}>
                <SidebarLink href={href} label={label} icon={icons[segment]} current={pathname === href || pathname.startsWith(`${href}/`)} />
              </li>
            ))}
          </ul>
        </nav>
      ) : (
        <div className="flex-1" />
      )}
      {email ? (
        <div className="border-t p-3">
          <SidebarIdentity icon={ShieldCheck} title={email} detail={roleLabel} className="px-2 py-1.5" />
        </div>
      ) : null}
    </>
  );
}
