import { redirect } from "next/navigation";
import * as z from "zod";
import { applicantsCsv } from "@/lib/applicants/csv";
import { isApplicationStatus } from "@/lib/applications/presentation";
import { exportApplicants, type ExportRefusal } from "@/lib/dal/applicant-list";
import { getJob } from "@/lib/dal/hiring";
import { requireOrgRole } from "@/lib/dal/session";
import { applicantsPath } from "@/lib/routes";
import { slugSchema } from "@/lib/validation/team";

const refusals: Record<ExportRefusal, { status: number; message: string }> = {
  not_found: { status: 404, message: "Not found" },
  not_in_plan: { status: 403, message: "Your plan does not include the CSV export." },
  too_many_rows: { status: 413, message: "There are too many applicants to export at once. Filter by stage." },
};

// The sign-in, consent and two-step pages send a person back to the address they came from, and for a POST that is this
// one: it leads to the list, where the export button is.
export async function GET(_request: Request, { params }: RouteContext<"/[lang]/org/[slug]/applicants/export">) {
  const { lang, slug } = await params;
  if (!slugSchema.safeParse(slug).success) return new Response("Not found", { status: 404 });
  redirect(applicantsPath(lang, slug));
}

// The export of the list of one vacancy, with the stage filter of the page: every row of the filter, not one page. It is
// a POST because it writes an audit row. The vacancy must be one of the organization in the address, so that the role and
// the two-step check are those of the organization that owns it.
export async function POST(request: Request, { params }: RouteContext<"/[lang]/org/[slug]/applicants/export">) {
  const { lang, slug } = await params;
  const form = await request.formData().catch(() => null);
  const jobId = z.uuid().safeParse(form?.get("job"));
  const rawStage = form?.get("stage") ?? null;
  const stage = isApplicationStatus(rawStage) ? rawStage : null;
  if (!slugSchema.safeParse(slug).success || !jobId.success || (rawStage !== "" && stage === null)) {
    return new Response("Not found", { status: 404 });
  }
  const { organization } = await requireOrgRole(lang, slug, "member", { hideFromOutsiders: true });
  if (organization.suspended || !(await getJob(organization.id, jobId.data))) return new Response("Not found", { status: 404 });

  const result = await exportApplicants(jobId.data, stage);
  if ("refusal" in result) {
    const { status, message } = refusals[result.refusal];
    return new Response(message, { status });
  }
  return new Response(applicantsCsv(result.rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="applicants-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
