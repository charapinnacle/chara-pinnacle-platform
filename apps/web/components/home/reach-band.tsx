import { Band } from "@/components/home/band";
import { StatisticsBlock } from "@/components/home/statistics-block";
import type { StatisticTile } from "@/lib/statistics/tiles";

type ReachBandProps = { figures: readonly { label: string; value: string }[]; tiles: StatisticTile[] };

// The scale of the platform in figures that are true at any size: the reference data every vacancy and passport is built
// on. The live counts follow only when they are credible (D87). A list, not a description list, so that the page holds a
// description list exactly when it shows live statistics (FR-H4 AC4).
export function ReachBand({ figures, tiles }: ReachBandProps) {
  return (
    <Band tone="dark" aria-labelledby="home-reach-heading" className="grid gap-14">
      <div className="grid gap-4">
        <h2 id="home-reach-heading" className="max-w-3xl font-serif text-section text-balance">
          Built for hiring across borders
        </h2>
        <p className="max-w-[56ch] text-lead text-pretty text-muted-foreground">
          Every vacancy and every passport uses the same international reference data.
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
        {figures.map(({ label, value }) => (
          <li key={label} className="flex flex-col-reverse gap-2 border-t border-brand pt-5">
            <span className="text-body text-muted-foreground">{label}</span>
            <span className="font-serif text-numeral tabular-nums">{value}</span>
          </li>
        ))}
      </ul>
      {tiles.length > 0 ? <StatisticsBlock tiles={tiles} /> : null}
    </Band>
  );
}
