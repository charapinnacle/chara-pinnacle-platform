import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { StageCounts } from "@/components/admin/stage-counts";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { Notice } from "@/components/forms/notice";
import { FormButton } from "@/components/forms/form-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requirePlatformRole } from "@/lib/dal/session";
import { rangeSchema } from "@/lib/validation/admin";

export const metadata: Metadata = { title: "Statistics — CHARA", robots: { index: false } };

// The default range is the last 30 days, today included.
function lastThirtyDays(): { from: string; to: string } {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: start.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) };
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

  return (
    <div className="grid gap-6">
      <PageHeader title="Statistics">
        <p className="text-body text-muted-foreground">Applications by stage, counted only. The days are in UTC, both included, at most 366.</p>
      </PageHeader>
      <form method="get" className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="grid gap-2">
          <Label htmlFor="stats-from">From</Label>
          <Input id="stats-from" name="from" type="date" defaultValue={from} className="h-11 bg-card px-3.5 text-base" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="stats-to">To</Label>
          <Input id="stats-to" name="to" type="date" defaultValue={to} className="h-11 bg-card px-3.5 text-base" />
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
    </div>
  );
}
