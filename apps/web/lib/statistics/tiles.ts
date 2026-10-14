import type { Database } from "@chara-pinnacle/db-types";
import { formatCount } from "@/lib/i18n/format";

type PlatformCounts = Database["public"]["Views"]["v_platform_counts"]["Row"];
export type StatisticTile = { label: string; value: string };

// The smallest live figure the home page shows (OPEN_QUESTIONS.md D87): the database already holds back every count below
// the privacy threshold (stats_min_count, at least 5); a count that is public but small reads as an empty platform, so the
// page leaves it out until it reaches this. It is the one place to change it.
const CREDIBLE_MINIMUM = 100;

const columns = [
  ["workers", "Workers"],
  ["employers", "Employers"],
  ["active_jobs", "Active jobs"],
  ["countries", "Countries"],
] as const;

// A value the database holds back (null, because its count is below the threshold) or one below the credible minimum gets
// no tile at all, so the block never shows a zero, a dash or an empty place for it (FR-H4 AC3).
export function statisticTiles(counts: PlatformCounts): StatisticTile[] {
  return columns.flatMap(([column, label]) => {
    const count = counts[column];
    return count === null || count < CREDIBLE_MINIMUM ? [] : [{ label, value: formatCount(count) }];
  });
}
