import type { Database } from "@chara-pinnacle/db-types";
import { pipelineStages } from "@/lib/applications/presentation";

type ApplicationStatus = Database["public"]["Enums"]["application_status"];

export type StageTotals = Record<ApplicationStatus, number>;

// The stages in which a candidate still waits for a decision: neither decided (hired, not selected) nor withdrawn.
export const openStages: readonly ApplicationStatus[] = ["applied", "viewed", "shortlisted", "interview", "offer"];

// Every stage of the pipeline with its count; a stage the rows do not name is 0.
export function stageTotals(rows: readonly { status: ApplicationStatus; total: number }[]): StageTotals {
  const totals = Object.fromEntries(pipelineStages.map((status) => [status, 0])) as StageTotals;
  for (const row of rows) totals[row.status] = row.total;
  return totals;
}

export function sumOf(totals: StageTotals, stages: readonly ApplicationStatus[] = pipelineStages): number {
  return stages.reduce((sum, status) => sum + totals[status], 0);
}
