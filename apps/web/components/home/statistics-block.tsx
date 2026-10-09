import type { StatisticTile } from "@/lib/statistics/tiles";

// The label comes first in the document, so that a screen reader says "Vacancies 15"; the value is shown above it.
export function StatisticsBlock({ tiles }: { tiles: StatisticTile[] }) {
  return (
    <section aria-labelledby="platform-statistics-heading" className="grid gap-4">
      <h2 id="platform-statistics-heading" className="text-2xl font-semibold tracking-tight">
        CHARA in numbers
      </h2>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {tiles.map(({ label, value }) => (
          <div key={label} className="flex flex-col-reverse gap-1 rounded-xl border bg-card p-5 shadow-card">
            <dt className="text-body font-medium text-muted-foreground">{label}</dt>
            <dd className="text-3xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
