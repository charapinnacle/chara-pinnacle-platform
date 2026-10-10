import { X } from "lucide-react";
import Link from "next/link";
import type { FilterChip } from "@/lib/jobs/filter-chips";

// Each chip is a link to the same search without that filter, so it works without JavaScript and its whole area is the
// touch target.
export function ActiveFilters({ chips }: { chips: FilterChip[] }) {
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Active filters" className="flex flex-wrap gap-2">
      {chips.map(({ name, label, href }) => (
        <li key={name}>
          <Link
            href={href}
            prefetch={false}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-input bg-card px-4 text-small hover:border-muted-foreground"
          >
            <span className="sr-only">Remove filter </span>
            <span className="wrap-anywhere">{label}</span>
            <X aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
