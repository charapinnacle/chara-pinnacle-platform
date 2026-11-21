import { ChartColumn } from "lucide-react";
import Link from "next/link";
import { ExportButton } from "@/components/applicants/export-button";
import { StageBar } from "@/components/dashboard/stage-bar";
import { EmptyState } from "@/components/feedback/empty-state";
import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import {
  analyticsFileName,
  analyticsPeriods,
  fewerThanText,
  hasDimension,
  metricLabel,
  periodLabels,
  type AnalyticsFigure,
  type AnalyticsMetric,
  type AnalyticsPeriod,
  type BreakdownRow,
} from "@/lib/analytics/presentation";
import type { OrganizationType } from "@/lib/billing/limits";
import { formatCount, formatDate } from "@/lib/i18n/format";
import { analyticsExportPath, analyticsPath, billingPath, organizationProfilePath, workforceProfilePath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { MemberRole } from "@/lib/validation/team";

export type AnalyticsViewProps = {
  lang: string;
  organization: { slug: string; type: OrganizationType; role: MemberRole };
  level: 0 | 1 | 2 | 3;
  hasFigures: boolean;
  fewerThan: number;
  period: AnalyticsPeriod;
  // The totals of the shown metrics, and the breakdowns when the plan includes them.
  totals: AnalyticsFigure[];
  byCountry: BreakdownRow[] | null;
  byOccupation: BreakdownRow[] | null;
};

// The analytics of an organisation at the level of its plan (FR-R6 AC8, AC12): totals, breakdowns by country and by
// occupation, and the CSV download of Enterprise. Counts only; a hidden count reads "fewer than 5".
export function AnalyticsView(props: AnalyticsViewProps) {
  const { lang, organization, level, hasFigures } = props;
  const manager = organization.role !== "member";
  const compare = manager ? (
    <TextLink standalone href={billingPath(lang, organization.slug)}>
      Compare plans
    </TextLink>
  ) : null;

  if (level === 0) {
    return (
      <EmptyState icon={ChartColumn} title="Your plan does not include analytics" description="The paid plans count profile views, invitations and responses.">
        {compare ?? <p className="text-small text-muted-foreground">An owner or admin of your company can change the plan.</p>}
      </EmptyState>
    );
  }

  if (!hasFigures) {
    const partner = organization.type !== "employer";
    return (
      <EmptyState
        icon={ChartColumn}
        title="No activity yet"
        description="Figures appear the day after employers or partners interact with your profile."
      >
        <TextLink
          standalone
          href={partner ? workforceProfilePath(lang, organization.slug) : organizationProfilePath(lang, organization.slug)}
        >
          Update your profile
        </TextLink>
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-section">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PeriodControl lang={lang} slug={organization.slug} period={props.period} />
        {level === 3 ? (
          <ExportButton
            action={analyticsExportPath(lang, organization.slug)}
            fields={{ period: props.period }}
            disabled={false}
            hint={null}
            label="Download CSV"
            fileName={analyticsFileName(organization.slug, props.period)}
          />
        ) : null}
      </div>
      <Totals {...props} />
      {level === 1 ? (
        <Notice tone="info" role="status" className="grid gap-1">
          <p>Breakdowns by country and occupation are included in Professional.</p>
          {compare}
        </Notice>
      ) : (
        <>
          <Breakdown
            id="by-country"
            dimension="country"
            title="By country"
            description="The country of the company that viewed your profile or acted with you."
            rowHeader="Country"
            rows={props.byCountry ?? []}
            {...props}
          />
          <Breakdown
            id="by-occupation"
            dimension="occupation"
            title="By occupation"
            description="The occupations of the workforce requirement. A requirement for several occupations counts in each."
            rowHeader="Occupation"
            rows={props.byOccupation ?? []}
            {...props}
          />
        </>
      )}
      <p className="text-small text-muted-foreground">
        {organization.type === "employer" ? null : "A profile view is counted once per company and day. No one sees who viewed your profile. "}
        A count below {props.fewerThan} reads &ldquo;{fewerThanText(props.fewerThan)}&rdquo;, so no company can be recognised
        from it.
      </p>
    </div>
  );
}

function PeriodControl({ lang, slug, period }: { lang: string; slug: string; period: AnalyticsPeriod }) {
  return (
    <div role="group" aria-labelledby="period-label" className="grid gap-2">
      <span id="period-label" className="text-small font-medium">
        Period
      </span>
      <div className="flex flex-wrap gap-2">
        {analyticsPeriods.map((option) => {
          const current = option === period;
          return (
            <Link
              key={option}
              href={analyticsPath(lang, slug, option)}
              aria-current={current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-lg border px-4 text-small font-medium transition-colors",
                current ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-secondary",
              )}
            >
              {periodLabels[option]}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function countText(value: number | null | undefined, fewerThan: number): string {
  return value === null || value === undefined ? fewerThanText(fewerThan) : formatCount(value);
}

function Totals({ organization, totals, fewerThan }: AnalyticsViewProps) {
  const max = Math.max(0, ...totals.map((figure) => figure.value ?? 0));
  const first = totals[0];
  return (
    <Card as="section" aria-labelledby="totals-heading" padding="lg" elevated className="content-start gap-4">
      <div className="grid gap-0.5">
        <h2 id="totals-heading" className="text-h2">
          Totals
        </h2>
        {first ? (
          <p className="text-small text-muted-foreground">
            {formatDate(first.periodStart)} to {formatDate(first.periodEnd)}
          </p>
        ) : null}
      </div>
      <table aria-labelledby="totals-heading" className="w-full text-body">
        <thead>
          <tr className="border-b text-small text-muted-foreground">
            <th scope="col" className="py-2 text-start font-medium">
              Metric
            </th>
            <th scope="col" className="py-2 text-end font-medium">
              Count
            </th>
          </tr>
        </thead>
        <tbody>
          {totals.map((figure) => (
            <tr key={figure.metric} className="border-b last:border-b-0">
              <th scope="row" className="py-2.5 text-start font-normal">
                {metricLabel(organization.type, figure.metric)}
              </th>
              <td className="py-2.5">
                <span className="flex items-center justify-end gap-4">
                  {figure.value === null ? null : <StageBar value={figure.value} max={max} />}
                  <span className="text-end whitespace-nowrap tabular-nums">{countText(figure.value, fewerThan)}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

type BreakdownProps = AnalyticsViewProps & {
  id: string;
  dimension: "country" | "occupation";
  title: string;
  description: string;
  rowHeader: string;
  rows: BreakdownRow[];
};

function Breakdown({ id, dimension, title, description, rowHeader, rows, totals, organization, fewerThan }: BreakdownProps) {
  const metrics: AnalyticsMetric[] = totals.map((figure) => figure.metric).filter((metric) => hasDimension(metric, dimension));
  return (
    <Card as="section" padding="lg" elevated className="content-start gap-4">
      <div className="grid gap-0.5">
        <h2 id={`${id}-heading`} className="text-h2">
          {title}
        </h2>
        <p className="text-small text-muted-foreground">{description}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-body text-muted-foreground">Nothing to break down in this period.</p>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border" role="region" aria-labelledby={`${id}-heading`} tabIndex={0}>
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="text-small text-muted-foreground">
                <th scope="col" className="sticky start-0 z-10 border-b bg-card p-3 text-start font-medium">
                  {rowHeader}
                </th>
                {metrics.map((metric) => (
                  <th key={metric} scope="col" className="min-w-32 border-b p-3 text-end font-medium">
                    {metricLabel(organization.type, metric)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code}>
                  <th scope="row" className="sticky start-0 z-10 border-b bg-card p-3 text-start font-normal">
                    {row.label}
                  </th>
                  {metrics.map((metric) => (
                    <td key={metric} className="border-b p-3 text-end whitespace-nowrap tabular-nums">
                      {countText(row.cells[metric], fewerThan)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
