import type { Database } from "@chara-pinnacle/db-types";
import { formatCount } from "@/lib/i18n/format";

type PlatformCounts = Database["public"]["Views"]["v_platform_counts"]["Row"];
export type StatisticTile = { label: string; value: string };

const columns = [
  ["workers", "Workers"],
  ["employers", "Employers"],
  ["active_jobs", "Active jobs"],
  ["countries", "Countries"],
] as const;

// A value the database holds back (null, because its count is below the threshold) gets no tile at all, so the block never
// shows a zero, a dash or an empty place for it (FR-H4 AC3).
export function statisticTiles(counts: PlatformCounts): StatisticTile[] {
  return columns.flatMap(([column, label]) => {
    const count = counts[column];
    return count === null ? [] : [{ label, value: formatCount(count) }];
  });
}
