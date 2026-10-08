"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function AdminNav({ entries }: { entries: readonly { label: string; href: string }[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Administration">
      <ul className="flex flex-wrap gap-2 lg:grid">
        {entries.map(({ label, href }) => {
          const current = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 w-full items-center rounded-lg border px-3 text-body font-medium",
                  current ? "border-primary bg-accent text-accent-foreground" : "bg-card hover:bg-secondary",
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
