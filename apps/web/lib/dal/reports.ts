import "server-only";
import type { Database } from "@chara-pinnacle/db-types";
import { createClient } from "@/lib/supabase/server";
import { visitorProof } from "@/lib/dal/rate-limit";
import { reportReferenceSchema } from "@/lib/validation/report";

type Enums = Database["public"]["Enums"];

const MY_REPORTS_PAGE_SIZE = 25;

export type MyReport = {
  id: number;
  reference: string;
  targetType: Enums["report_target_type"];
  targetLabel: string;
  category: Enums["report_category"];
  status: Enums["report_status"];
  resolutionNote: string | null;
  handledAt: string | null;
  createdAt: string;
};

type MyReportsCursor = { at: string; id: number };

type Target =
  | { type: "job" | "company"; job: string }
  | { type: "profile"; application: string }
  | { type: "content"; path: string };

type Report = { category: Enums["report_category"]; details: string; email: string };

// One call stores the report and counts the attempt against the visitor throttle (action report), so the web tier cannot
// forget the count and a direct call of the function cannot skip it. A refusal is returned for the action to explain.
export async function submitReport(target: Target, report: Report) {
  const { key, proof } = await visitorProof("report");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_report", {
    p_target_type: target.type,
    p_job: "job" in target ? target.job : undefined,
    p_application: "application" in target ? target.application : undefined,
    p_path: "path" in target ? target.path : undefined,
    p_category: report.category,
    p_details: report.details,
    p_good_faith: true,
    p_email: report.email || undefined,
    p_key: key,
    p_proof: proof,
  });
  if (error) return { ok: false, error } as const;
  const [row] = reportReferenceSchema.array().length(1).parse(data);
  return { ok: true, reference: row.reference } as const;
}

// The reports of the signed-in user, newest first, from a keyset cursor on. One row more than a page is read to know whether
// there is a next page.
export async function listMyReports(after: MyReportsCursor | null): Promise<{ reports: MyReport[]; next: MyReportsCursor | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_reports", {
    p_limit: MY_REPORTS_PAGE_SIZE + 1,
    p_after_created: after?.at,
    p_after_id: after?.id,
  });
  if (error) throw new Error("The reports could not be loaded", { cause: error });
  const page = data.slice(0, MY_REPORTS_PAGE_SIZE).map(
    (row): MyReport => ({
      id: row.id,
      reference: row.reference,
      targetType: row.target_type,
      targetLabel: row.target_label,
      category: row.category,
      status: row.status,
      resolutionNote: row.resolution_note ?? null,
      handledAt: row.handled_at ?? null,
      createdAt: row.created_at,
    }),
  );
  const last = page.at(-1);
  return { reports: page, next: data.length > MY_REPORTS_PAGE_SIZE && last ? { at: last.createdAt, id: last.id } : null };
}
