import { ArrowRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { cardVariants } from "@/components/layout/card";
import { cn } from "@/lib/utils";

// hint belongs to the label and is part of the name ("New applications in the last 7 days"); detail is a further line
// that describes the card.
type SummaryCardProps = { label: string; hint?: string; detail?: string; value: number; href: string; icon: LucideIcon };

// A figure of a dashboard. The whole card is the link to the list it counts; its name carries the number, as in
// "Open vacancies: 2", so the visible "View all" is not read twice.
export function SummaryCard({ label, hint, detail, value, href, icon: Icon }: SummaryCardProps) {
  const detailId = useId();
  return (
    <Link
      href={href}
      aria-label={`${hint ? `${label} ${hint}` : label}: ${value}`}
      aria-describedby={detail ? detailId : undefined}
      className={cn(
        cardVariants({ padding: "lg", elevated: true }),
        "group min-h-11 content-between gap-4 transition-[border-color,box-shadow,translate] duration-200 ease-brand hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-md",
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="grid gap-0.5">
          <span className="text-small font-medium text-foreground">{label}</span>
          {hint ? <span className="text-small text-muted-foreground">{hint}</span> : null}
          {detail ? (
            <span id={detailId} className="text-small text-muted-foreground">
              {detail}
            </span>
          ) : null}
        </span>
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-brand-ink">
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
      </span>
      <span className="flex items-end justify-between gap-3">
        <span className="text-figure tabular-nums">{value}</span>
        <span aria-hidden className="inline-flex items-center gap-1 text-small font-medium text-muted-foreground transition-colors duration-150 group-hover:text-foreground">
          View all
          <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
        </span>
      </span>
    </Link>
  );
}
