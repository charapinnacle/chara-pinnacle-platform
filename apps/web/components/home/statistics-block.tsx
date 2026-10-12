import type { StatisticTile } from "@/lib/statistics/tiles";

// The live figures, inside the reach band, only when there is a tile. The label comes first in the document, so that a
// screen reader says "Active jobs 150"; the value is shown above it.
export function StatisticsBlock({ tiles }: { tiles: StatisticTile[] }) {
  return (
    <section aria-labelledby="platform-statistics-heading" className="grid gap-8 border-t pt-10">
      <h2 id="platform-statistics-heading" className="font-serif text-h1 font-normal">
        Global Workforce Network
      </h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
        {tiles.map(({ label, value }) => (
          <div key={label} className="flex flex-col-reverse gap-2">
            <dt className="text-body text-muted-foreground">{label}</dt>
            <dd className="font-serif text-numeral tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
