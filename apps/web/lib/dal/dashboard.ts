import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { z } from "zod";
import { pipelineStages } from "@/lib/applications/presentation";
import { logDashboardLoad } from "@/lib/dashboard/load-log";
import { type PlanStatus, planStatuses } from "@/lib/dashboard/plan-status";
import { createClient } from "@/lib/supabase/server";

type ApplicationStatus = Database["public"]["Enums"]["application_status"];

export type DashboardApplications = {
  byStage: Record<ApplicationStatus, number>;
  total: number;
  recent: number;
};

type VacancySummary = { open: number; any: boolean };

export type DashboardPlan = {
  planName: string;
  status: PlanStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  pastDueSince: Date | null;
  subscriptionEnded: boolean;
};

// The function types its columns as not null, and the dates of a plan without them are null.
const planRow = z.object({
  plan_name: z.string(),
  status: z.enum(planStatuses),
  trial_ends_at: z.iso.datetime({ offset: true }).nullable(),
  current_period_end: z.iso.datetime({ offset: true }).nullable(),
  past_due_since: z.iso.datetime({ offset: true }).nullable(),
  subscription_ended: z.boolean(),
});

// The page shows an error card for a failed read and says nothing more, so the operator finds the code here.
function readFailed(read: string, message: string, error: { code?: string; message: string } | null): Error {
  console.error(`Dashboard ${read} read failed`, { code: error?.code, message: error?.message });
  return new Error(message, { cause: error });
}

const toDate = (value: string | null) => (value ? new Date(value) : null);

// Everything on the dashboard is read again on each load; nothing is stored or cached. The rights of the member decide
// what each read returns (FR-D5 for the applications, the vacancy policy for the vacancies).

// The applications by stage (a stage with none is 0) and the number made in the last 7 x 24 hours.
async function getDashboardApplications(organizationId: string): Promise<DashboardApplications> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_dashboard_applications", { p_organization_id: organizationId });
  if (error) throw readFailed("applications", "The applications could not be counted", error);
  const byStage = Object.fromEntries(pipelineStages.map((status) => [status, 0])) as Record<ApplicationStatus, number>;
  let recent = 0;
  for (const row of data) {
    byStage[row.status] = row.total;
    recent += row.recent;
  }
  return { byStage, total: Object.values(byStage).reduce((sum, count) => sum + count, 0), recent };
}

// The vacancies that are open and not deleted, and whether the organisation has had any vacancy.
async function getVacancySummary(organizationId: string): Promise<VacancySummary> {
  const supabase = await createClient();
  const [open, any] = await Promise.all([
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "open")
      .is("deleted_at", null),
    supabase.from("jobs").select("id").eq("organization_id", organizationId).is("deleted_at", null).limit(1),
  ]);
  if (open.error || open.count === null || any.error) {
    throw readFailed("vacancies", "The vacancies could not be counted", open.error ?? any.error);
  }
  return { open: open.count, any: any.data.length > 0 };
}

async function getDashboardPlan(organizationId: string): Promise<DashboardPlan> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_dashboard_plan", { p_organization_id: organizationId });
  if (error) throw readFailed("plan", "The plan could not be loaded", error);
  const row = planRow.parse(data[0]);
  return {
    planName: row.plan_name,
    status: row.status,
    trialEndsAt: toDate(row.trial_ends_at),
    currentPeriodEnd: toDate(row.current_period_end),
    pastDueSince: toDate(row.past_due_since),
    subscriptionEnded: row.subscription_ended,
  };
}

// Starts the reads together, so that a slow one does not delay the others, and logs the load time once all are done. The
// page hands each promise to the part that shows it; nothing is awaited here. A fresh start on each render of the page,
// so a retry reads everything again.
export function startDashboardLoad(organizationId: string) {
  const started = performance.now();
  const applications = getDashboardApplications(organizationId);
  const vacancies = getVacancySummary(organizationId);
  const plan = getDashboardPlan(organizationId);
  void Promise.allSettled([applications, vacancies, plan]).then((results) => {
    logDashboardLoad(performance.now() - started, results.every((result) => result.status === "fulfilled") ? "ok" : "error");
  });
  const empty = Promise.all([vacancies, applications]).then(
    ([{ any }, { total }]) => !any && total === 0,
    () => false,
  );
  return { applications, vacancies, plan, empty };
}
