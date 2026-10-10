import type { StatisticTile } from "@/lib/statistics/tiles";

// The label comes first in the document, so that a screen reader says "Vacancies 15"; the value is shown above it.
export function StatisticsBlock({ tiles }: { tiles: StatisticTile[] }) {
  return (
    <section aria-labelledby="platform-statistics-heading" className="grid gap-6">
      <h2 id="platform-statistics-heading" className="text-eyebrow text-brand-ink uppercase">
        CHARA in numbers
      </h2>
      <dl className="grid animate-stagger grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
        {tiles.map(({ label, value }) => (
          <div key={label} className="flex flex-col-reverse gap-1 border-t border-foreground/15 pt-5">
            <dt className="text-body text-muted-foreground">{label}</dt>
            <dd className="text-figure tabular-nums sm:text-display">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
