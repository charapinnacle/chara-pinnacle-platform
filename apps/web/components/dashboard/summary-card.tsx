import Link from "next/link";

type SummaryCardProps = { label: string; hint?: string; value: number; href: string };

// The whole card is the link; its name carries the number, as in "Open vacancies: 2".
export function SummaryCard({ label, hint, value, href }: SummaryCardProps) {
  return (
    <Link
      href={href}
      aria-label={`${hint ? `${label} ${hint}` : label}: ${value}`}
      className="grid min-h-11 content-start gap-1 rounded-xl border bg-card p-5 shadow-card hover:border-primary/40"
    >
      <span className="text-body font-medium text-muted-foreground">{label}</span>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
      {hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
    </Link>
  );
}
