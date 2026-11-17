import { redirect } from "next/navigation";
import { analyticsCsv, analyticsFileName, analyticsPeriods, shownMetric } from "@/lib/analytics/presentation";
import { exportAnalytics, getAnalyticsAccess, type AnalyticsExportRefusal } from "@/lib/dal/analytics";
import { getCountries, getOccupations } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";
import { analyticsPath } from "@/lib/routes";
import { slugSchema } from "@/lib/validation/team";

const refusals: Record<AnalyticsExportRefusal, { status: number; message: string }> = {
  not_found: { status: 404, message: "Not found" },
  not_in_plan: { status: 403, message: "Your plan does not include the analytics export. Enterprise does." },
};

// The sign-in, consent and two-step pages send a person back to the address they came from, and for a POST that is this
// one: it leads to the page, where the download button is.
export async function GET(_request: Request, { params }: RouteContext<"/[lang]/org/[slug]/analytics/export">) {
  const { lang, slug } = await params;
  if (!slugSchema.safeParse(slug).success) return new Response("Not found", { status: 404 });
  redirect(analyticsPath(lang, slug));
}

// The CSV of one period (FR-R6 AC9, AC10). It is a POST because the database writes an audit row.
export async function POST(request: Request, { params }: RouteContext<"/[lang]/org/[slug]/analytics/export">) {
  const { lang, slug } = await params;
  const form = await request.formData().catch(() => null);
  const period = analyticsPeriods.find((option) => option === form?.get("period"));
  if (!slugSchema.safeParse(slug).success || !period || !(await isReleased("release_partner_directories"))) {
    return new Response("Not found", { status: 404 });
  }
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true, partner: "either" });
  if (organization.suspended) return new Response("Not found", { status: 404 });

  const result = await exportAnalytics(organization.id, period);
  if ("refusal" in result) {
    const { status, message } = refusals[result.refusal];
    return new Response(message, { status });
  }
  const [{ fewerThan }, countries, occupations] = await Promise.all([getAnalyticsAccess(organization.id), getCountries(), getOccupations()]);
  const figures = result.figures.filter((figure) => shownMetric(organization.type, figure.metric));
  const csv = analyticsCsv(figures, {
    countries: new Map(countries.map(({ code, name }) => [code, name])),
    occupations: new Map(occupations.map(({ code, label }) => [code, label])),
    fewerThan,
  });
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${analyticsFileName(organization.slug, period)}"`,
      "cache-control": "no-store",
    },
  });
}
