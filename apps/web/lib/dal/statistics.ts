import "server-only";
import { createClient } from "@/lib/supabase/server";
import { statisticTiles, type StatisticTile } from "@/lib/statistics/tiles";

// The statistics are decoration of the home page: when the read fails the page shows no block and the error goes to the
// log, where the operator finds the code (FR-H4 AC12).
export async function getPlatformStatistics(): Promise<StatisticTile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("v_platform_counts").select("active_jobs, employers, workers, countries").single();
  if (error) {
    console.error("Platform statistics read failed", { code: error.code, message: error.message });
    return [];
  }
  return statisticTiles(data);
}
