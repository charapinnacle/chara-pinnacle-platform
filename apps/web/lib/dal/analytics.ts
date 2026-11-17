import "server-only";
import * as z from "zod";
import {
  analyticsMetrics,
  type AnalyticsDimension,
  type AnalyticsFigure,
  type AnalyticsPeriod,
} from "@/lib/analytics/presentation";
import { createClient } from "@/lib/supabase/server";

export type AnalyticsAccess = { level: 0 | 1 | 2 | 3; hasFigures: boolean; fewerThan: number };

const accessRow = z.object({
  analytics_level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  has_figures: z.boolean(),
  fewer_than: z.number().int().positive(),
});

const figureRows = z.array(
  z.object({
    period_start: z.string(),
    period_end: z.string(),
    metric: z.enum(analyticsMetrics),
    country_code: z.string().nullable(),
    occupation_id: z.string().nullable(),
    value: z.number().int().nonnegative().nullable(),
    suppressed: z.boolean(),
  }),
);

function toFigures(data: unknown): AnalyticsFigure[] {
  return figureRows.parse(data).map((row) => ({
    periodStart: row.period_start,
    periodEnd: row.period_end,
    metric: row.metric,
    country: row.country_code,
    occupation: row.occupation_id,
    value: row.suppressed ? null : row.value,
  }));
}

// The level of the plan, whether there is any figure yet and the threshold below which a count is hidden (FR-R6 AC8,
// AC12). The function refuses anyone who is not a member of the organisation.
export async function getAnalyticsAccess(organizationId: string): Promise<AnalyticsAccess> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_org_analytics_access", { p_org: organizationId });
  if (error) throw new Error("The analytics level could not be loaded", { cause: error });
  const row = accessRow.parse(data[0]);
  return { level: row.analytics_level, hasFigures: row.has_figures, fewerThan: row.fewer_than };
}

// The figures of one period and dimension, suppressed in the database (FR-R6 AC4, AC5). The page asks only for what the
// plan includes.
export async function getAnalyticsFigures(
  organizationId: string,
  period: AnalyticsPeriod,
  dimension: AnalyticsDimension,
): Promise<AnalyticsFigure[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_org_analytics", { p_org: organizationId, p_period: period, p_dimension: dimension });
  if (error) throw new Error("The analytics could not be loaded", { cause: error });
  return toFigures(data);
}

export type AnalyticsExportRefusal = "not_found" | "not_in_plan";

// The export of Enterprise (FR-R6 AC9, AC10); the database writes its audit row.
export async function exportAnalytics(
  organizationId: string,
  period: AnalyticsPeriod,
): Promise<{ figures: AnalyticsFigure[] } | { refusal: AnalyticsExportRefusal }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("export_org_analytics", { p_org: organizationId, p_period: period });
  if (error) {
    switch (error.message) {
      case "CHARA_FORBIDDEN":
        return { refusal: "not_found" };
      case "CHARA_FEATURE_NOT_IN_PLAN":
        return { refusal: "not_in_plan" };
      default:
        throw new Error("The analytics could not be exported", { cause: error });
    }
  }
  return { figures: toFigures(data) };
}
