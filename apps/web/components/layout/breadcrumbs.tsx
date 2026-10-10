import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { Crumb } from "@/lib/app/navigation";

// Where the page sits in its area, from the first page down to this one. The last item names the page itself and is not a
// link; every earlier item has an address.
export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-small">
      <ol className="flex flex-wrap items-center gap-x-1">
        {items.map(({ label, href }, index) => (
          <li key={label} className="flex min-w-0 items-center gap-x-1">
            {index > 0 ? <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
            {href ? (
              <Link href={href} className="inline-flex min-h-11 items-center rounded-sm text-primary underline underline-offset-4 [overflow-wrap:anywhere]">
                {label}
              </Link>
            ) : (
              <span aria-current="page" className="font-medium [overflow-wrap:anywhere]">
                {label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
