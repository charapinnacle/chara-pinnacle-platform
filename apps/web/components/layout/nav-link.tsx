"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCurrent, type NavLink as Entry } from "@/lib/app/navigation";
import { cn } from "@/lib/utils";

const base = "inline-flex min-h-11 w-full items-center rounded-lg px-3 text-small font-medium hover:bg-accent";

// A link of a navigation list. The current page is marked for assistive technology and drawn with the accent colour.
export function NavLink({ link, className }: { link: Entry; className?: string }) {
  const current = isCurrent(usePathname(), link);
  return (
    <Link
      href={link.href}
      aria-current={current ? "page" : undefined}
      className={cn(base, current && "bg-accent text-accent-foreground", className)}
    >
      {link.label}
    </Link>
  );
}
