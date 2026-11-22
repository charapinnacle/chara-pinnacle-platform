import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { NetworkStatistics } from "@/components/admin/network-statistics";
import { PartnerSearchCounts } from "@/components/admin/partner-search-counts";
import { StageCounts } from "@/components/admin/stage-counts";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { DatePicker } from "@/components/forms/date-picker";
import { Notice } from "@/components/forms/notice";
import { FormButton } from "@/components/forms/form-button";
import { Label } from "@/components/ui/label";
import { networkStatisticsAction } from "@/lib/actions/admin-statistics";
import type { PartnerSearchKind } from "@/lib/dal/admin";
import { isReleased } from "@/lib/dal/release";
import { requirePlatformRole } from "@/lib/dal/session";
import { lastSixMonths, lastThirtyDays, rangeSchema } from "@/lib/validation/admin";

export const metadata: Metadata = { title: "Statistics", robots: { index: false } };

// The first answer of the partner network section is read on the server, with the default range of six months by month.
async function PartnerNetwork() {
  const defaults = { ...lastSixMonths(), period: "month" as const };
  return <NetworkStatistics defaults={defaults} initial={await networkStatisticsAction(defaults)} />;
}

function value(raw: string | string[] | undefined, fallback: string): string {
  return typeof raw === "string" ? raw : fallback;
}

export default async function StatisticsPage({ params, searchParams }: PageProps<"/[lang]/admin/statistics">) {
  const [{ lang }, query] = await Promise.all([params, searchParams]);
  await requirePlatformRole(lang, ["admin"]);
  const initial = lastThirtyDays();
  const from = value(query.from, initial.from);
  const to = value(query.to, initial.to);
  const range = rangeSchema.safeParse({ from, to });
  const [partnerNetwork, jobOrders] = await Promise.all([isReleased("release_partner_directories"), isReleased("release_job_orders")]);
  const searchKinds: PartnerSearchKind[] = ["recruitment", "staffing", "available_workforce", ...(jobOrders ? ["employers" as const] : [])];

  return (
    <div className="grid max-w-3xl gap-page">
      <PageHeader title="Statistics">
        <p className="text-body text-muted-foreground">
          Applications by stage{partnerNetwork ? ", partner searches and the partner network" : ""}, counted only. The days are in UTC, both included, at most 366.
        </p>
      </PageHeader>
      <form method="get" className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="grid gap-2">
          <Label htmlFor="stats-from">From</Label>
          <DatePicker id="stats-from" name="from" defaultValue={from} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="stats-to">To</Label>
          <DatePicker id="stats-to" name="to" defaultValue={to} />
        </div>
        <FormButton type="submit" className="w-full sm:w-auto">
          Show
        </FormButton>
      </form>
      {range.success ? (
        <Suspense key={`${from}/${to}`} fallback={<LoadingSkeleton rows={4} />}>
          <StageCounts from={range.data.from} to={range.data.to} />
        </Suspense>
      ) : (
        <Notice tone="error" role="alert">
          {range.error.issues[0].message}
        </Notice>
      )}
      {range.success && partnerNetwork ? (
        <section aria-labelledby="partner-searches-heading" className="grid gap-4">
          <h2 id="partner-searches-heading" className="text-h2">
            Partner searches
          </h2>
          {searchKinds.map((kind) => (
            <Suspense key={`${kind}/${from}/${to}`} fallback={<LoadingSkeleton rows={3} />}>
              <PartnerSearchCounts kind={kind} from={range.data.from} to={range.data.to} />
            </Suspense>
          ))}
        </section>
      ) : null}
      {partnerNetwork ? (
        <section aria-labelledby="partner-network-heading" className="grid gap-4">
          <h2 id="partner-network-heading" className="text-h2">
            Partner network
          </h2>
          <p className="text-body text-muted-foreground">
            Partner organisations, their review and moderation, searches, saves and follows per period, with their own range
            and period. A value below the privacy threshold is not shown.
          </p>
          <Suspense fallback={<LoadingSkeleton rows={6} />}>
            <PartnerNetwork />
          </Suspense>
        </section>
      ) : null}
    </div>
  );
}
