"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCurrent } from "@/lib/app/navigation";
import { cn } from "@/lib/utils";

type AdminNavProps = {
  entries: readonly { label: string; href: string; exact?: true }[];
  // The plan editor uses the same grid for its own pages (Plans, Overrides).
  label?: string;
  className?: string;
};

export function AdminNav({ entries, label = "Administration", className }: AdminNavProps) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className={className}>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {entries.map(({ label: text, href, exact }) => {
          const current = isCurrent(pathname, { match: href, exact });
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 w-full items-center rounded-lg border px-3 py-1 text-small font-medium leading-tight transition-colors duration-150",
                  current ? "border-brand-ink/40 bg-accent text-accent-foreground" : "bg-card hover:bg-secondary",
                )}
              >
                {text}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
