import Link from "next/link";
import { cardVariants } from "@/components/layout/card";
import { cn } from "@/lib/utils";

type SummaryCardProps = { label: string; hint?: string; value: number; href: string };

// The whole card is the link; its name carries the number, as in "Open vacancies: 2".
export function SummaryCard({ label, hint, value, href }: SummaryCardProps) {
  return (
    <Link
      href={href}
      aria-label={`${hint ? `${label} ${hint}` : label}: ${value}`}
      className={cn(cardVariants({ padding: "lg", elevated: true }), "min-h-11 content-start gap-1 hover:border-primary/40")}
    >
      <span className="text-body font-medium text-muted-foreground">{label}</span>
      <span className="text-figure tabular-nums">{value}</span>
      {hint ? <span className="text-small text-muted-foreground">{hint}</span> : null}
    </Link>
  );
}
