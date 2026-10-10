"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function AdminNav({ entries, className }: { entries: readonly { label: string; href: string }[]; className?: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Administration" className={className}>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {entries.map(({ label, href }) => {
          const current = pathname === href || pathname.startsWith(`${href}/`);
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
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
