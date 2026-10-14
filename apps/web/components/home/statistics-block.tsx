import { Band } from "@/components/public/band";
import type { StatisticTile } from "@/lib/statistics/tiles";

// The live figures, only when there is a tile. The label comes first in the document, so that a screen reader says
// "Active jobs 150"; the value is shown above it.
export function StatisticsBlock({ tiles }: { tiles: StatisticTile[] }) {
  return (
    <Band aria-labelledby="platform-statistics-heading" className="grid gap-10">
      <h2 id="platform-statistics-heading" className="text-h2">
        Global Workforce Network
      </h2>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-10 lg:grid-cols-4">
        {tiles.map(({ label, value }) => (
          <div key={label} className="flex flex-col-reverse gap-2 border-t pt-6">
            <dt className="text-body text-muted-foreground">{label}</dt>
            <dd className="text-section tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </Band>
  );
}
