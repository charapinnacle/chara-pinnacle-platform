import { Card } from "@/components/layout/card";
import type { StatisticTile } from "@/lib/statistics/tiles";

// The label comes first in the document, so that a screen reader says "Vacancies 15"; the value is shown above it.
export function StatisticsBlock({ tiles }: { tiles: StatisticTile[] }) {
  return (
    <section aria-labelledby="platform-statistics-heading" className="grid gap-4">
      <h2 id="platform-statistics-heading" className="text-h1">
        CHARA in numbers
      </h2>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {tiles.map(({ label, value }) => (
          <Card key={label} padding="lg" elevated className="flex flex-col-reverse gap-1">
            <dt className="text-body font-medium text-muted-foreground">{label}</dt>
            <dd className="text-figure tabular-nums">{value}</dd>
          </Card>
        ))}
      </dl>
    </section>
  );
}
