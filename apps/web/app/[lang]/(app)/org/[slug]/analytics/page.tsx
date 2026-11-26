import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AnalyticsView } from "@/components/analytics/analytics-view";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { SuspendedOrganization } from "@/components/layout/suspended-organization";
import { breakdownRows, parsePeriod, shownMetric, type AnalyticsFigure } from "@/lib/analytics/presentation";
import { organizationCrumb } from "@/lib/app/navigation";
import { getAnalyticsAccess, getAnalyticsFigures } from "@/lib/dal/analytics";
import { getCountries, getOccupations } from "@/lib/dal/reference";
import { isReleased } from "@/lib/dal/release";
import { requireOrgRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Analytics", robots: { index: false } };

// The analytics of an organisation (FR-R6 AC8, AC12), for every member, while release 2a is on: the totals of the period
// on every paid plan, the breakdowns by country and occupation from Professional and the CSV download on Enterprise. The
// job order metrics follow their own releases in the database. Like the dashboard, it asks no code of owners and admins:
// its figures are counts that name no one.
export default async function AnalyticsPage({ params, searchParams }: PageProps<"/[lang]/org/[slug]/analytics">) {
  const [{ lang, slug }, { period: rawPeriod }] = await Promise.all([params, searchParams]);
  if (!(await isReleased("release_partner_directories"))) notFound();
  const { organization } = await requireOrgRole(lang, slug, "member", { mfa: false, hideFromOutsiders: true, partner: "either" });
  if (organization.suspended) return <SuspendedOrganization title="Analytics" subject="analytics" />;

  const period = parsePeriod(rawPeriod);
  const access = await getAnalyticsAccess(organization.id);
  const ready = access.level >= 1 && access.hasFigures;
  const breakdowns = ready && access.level >= 2;
  const shown = (figures: AnalyticsFigure[]) => figures.filter((figure) => shownMetric(organization.type, figure.metric));
  const [totals, byCountry, byOccupation, countries, occupations] = await Promise.all([
    ready ? getAnalyticsFigures(organization.id, period, "total") : [],
    breakdowns ? getAnalyticsFigures(organization.id, period, "country") : null,
    breakdowns ? getAnalyticsFigures(organization.id, period, "occupation") : null,
    breakdowns ? getCountries() : [],
    breakdowns ? getOccupations() : [],
  ]);

  return (
    <div className="grid w-full gap-section">
      <PageHeader
        title="Analytics"
        description="How your company does on the partner network: counts only, never who viewed your profile or acted."
        breadcrumb={<Breadcrumbs items={[organizationCrumb(lang, organization), { label: "Analytics" }]} />}
      />
      <AnalyticsView
        lang={lang}
        organization={organization}
        level={access.level}
        hasFigures={access.hasFigures}
        fewerThan={access.fewerThan}
        period={period}
        totals={shown(totals)}
        byCountry={byCountry && breakdownRows(shown(byCountry), "country", new Map(countries.map(({ code, name }) => [code, name])))}
        byOccupation={
          byOccupation && breakdownRows(shown(byOccupation), "occupation", new Map(occupations.map(({ code, label }) => [code, label])))
        }
      />
    </div>
  );
}
