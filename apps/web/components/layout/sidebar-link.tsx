import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type SidebarLinkProps = { href: string; label: string; icon: LucideIcon; current: boolean };

// A row of the sidebar: icon and label, the current page raised on the card surface with a gold mark at its start.
export function SidebarLink({ href, label, icon: Icon, current }: SidebarLinkProps) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "group relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-small font-medium transition-[background-color,color,box-shadow] duration-150 ease-brand",
        current
          ? "bg-card text-foreground shadow-card ring-1 ring-border before:absolute before:inset-y-2.5 before:start-0 before:w-0.5 before:rounded-full before:bg-brand"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      <Icon aria-hidden strokeWidth={1.75} className={cn("size-4 shrink-0", current ? "text-brand-ink" : "text-muted-foreground group-hover:text-foreground")} />
      <span className="truncate">{label}</span>
    </Link>
  );
}
