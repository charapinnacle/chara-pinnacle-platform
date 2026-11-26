import Link from "next/link";
import { cn } from "@/lib/utils";

export type TabLink = { key: string; href: string; label: React.ReactNode; current: boolean };

// Links that switch the view of one page (a status filter, a source, a period): one underlined row, the current one in
// ink, that scrolls sideways on a phone instead of wrapping.
export function TabLinks({ label, items, className }: { label: string; items: readonly TabLink[]; className?: string }) {
  return (
    <nav aria-label={label} className={cn("-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", className)}>
      <ul className="flex min-w-max gap-1 border-b">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex min-h-11 items-center rounded-t-md border-b-2 px-3 text-small font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                item.current ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
