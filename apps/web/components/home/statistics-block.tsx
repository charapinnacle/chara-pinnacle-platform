import { Band } from "@/components/home/band";
import type { StatisticTile } from "@/lib/statistics/tiles";

// The label comes first in the document, so that a screen reader says "Active jobs 15"; the value is shown above it. The
// figures are set large in the serif on a dark band.
export function StatisticsBlock({ tiles }: { tiles: StatisticTile[] }) {
  return (
    <Band tone="dark" aria-labelledby="platform-statistics-heading" className="grid gap-14">
      <h2 id="platform-statistics-heading" className="font-serif text-section">
        Global Workforce Network
      </h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
        {tiles.map(({ label, value }) => (
          <div key={label} className="flex flex-col-reverse gap-2 border-t border-brand pt-5">
            <dt className="text-body text-muted-foreground">{label}</dt>
            <dd className="font-serif text-numeral tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </Band>
  );
}
