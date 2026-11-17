"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { useNetworkStatistics } from "@/components/admin/use-network-statistics";
import { LoadError } from "@/components/feedback/load-error";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { FormButton } from "@/components/forms/form-button";
import { InputField } from "@/components/forms/form-field";
import { Notice } from "@/components/forms/notice";
import { SelectField } from "@/components/forms/select-field";
import type { NetworkStatisticsAnswer } from "@/lib/actions/admin-statistics";
import {
  countedRange,
  countText,
  dayLabel,
  figureLabel,
  figureText,
  hasNoActivity,
  metricRows,
  periodLabel,
  shownMetricGroups,
  type NetworkFigure,
} from "@/lib/admin/network-statistics";
import {
  networkPeriodLabels,
  networkPeriods,
  networkStatisticsSchema,
  type NetworkStatisticsForm,
  type NetworkStatisticsQuery,
} from "@/lib/validation/admin";

const rowHead = `${cell} text-start font-normal`;

const periodOptions = networkPeriods.map((period) => ({ value: period, label: networkPeriodLabels[period] }));

function FiguresTable({ caption, figures, minCount }: { caption: string; figures: NetworkFigure[]; minCount: number }) {
  const rows = figures.flatMap((figure) => {
    const label = figureLabel(figure);
    return label ? [{ figure, label }] : [];
  });
  return (
    <ResultsTable caption={caption} columns={["Figure", "Value", "Based on"]}>
      {rows.map(({ figure, label }) => (
        <tr key={figure.metric}>
          <th scope="row" className={rowHead}>
            {label}
          </th>
          <td className={cell}>{figureText(figure, minCount)}</td>
          <td className={cell}>{figure.base === null ? "-" : figure.base}</td>
        </tr>
      ))}
    </ResultsTable>
  );
}

// The Partner network section of the statistics page (FR-S2 AC7, AC9): counts per period with the change from the
// period before, and the key figures of the range and of now. Values below the threshold read "fewer than" it; no
// organisation, person or content is ever shown.
export function NetworkStatistics({ defaults, initial }: { defaults: NetworkStatisticsQuery; initial: NetworkStatisticsAnswer }) {
  const { state, load } = useNetworkStatistics(defaults, initial);
  const { control, handleSubmit } = useForm<NetworkStatisticsForm, unknown, NetworkStatisticsQuery>({
    resolver: zodResolver(networkStatisticsSchema),
    defaultValues: defaults,
  });

  const { query, statistics } = state;
  const counted = statistics ? countedRange(statistics.counts, query.period) : null;

  return (
    <div className="grid gap-page">
      <form noValidate onSubmit={handleSubmit(load)} className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <InputField control={control} name="from" id="network-from" label="From" type="date" />
        <InputField control={control} name="to" id="network-to" label="To" type="date" />
        <SelectField control={control} name="period" id="network-period" label="Period" placeholder="Choose a period" options={periodOptions} />
        <FormButton type="submit" busy={state.status === "loading"} className="w-full sm:mt-7 sm:w-auto">
          Show
        </FormButton>
      </form>
      <div aria-busy={state.status === "loading"} className="grid gap-page">
        {state.status === "loading" ? <LoadingSkeleton rows={6} /> : null}
        {state.status === "error" ? <LoadError title="The partner network statistics could not be loaded" retry={() => load(query)} /> : null}
        {state.status === "ready" && statistics ? (
          <>
            <p className="text-body text-muted-foreground">
              {counted ? `Whole periods from ${dayLabel(counted.from)} to ${dayLabel(counted.to)}. ` : ""}
              {statistics.statesFrom
                ? `States recorded from ${dayLabel(statistics.statesFrom)}; a state of an earlier period reads "-".`
                : "No states recorded yet."}
            </p>
            {hasNoActivity(statistics.counts) ? (
              <Notice tone="info" role="status">
                Every count of this period is below the privacy threshold of {statistics.minCount}, so the counts are hidden; there
                may still have been some activity.
              </Notice>
            ) : null}
            <section aria-labelledby="network-figures-heading" className="grid gap-4">
              <h3 id="network-figures-heading" className="text-h3">
                Key figures
              </h3>
              <FiguresTable
                caption={`Key figures from ${query.from} to ${query.to}`}
                figures={statistics.figures.filter((figure) => figure.rangeFigure)}
                minCount={statistics.minCount}
              />
              <FiguresTable
                caption="Key figures now"
                figures={statistics.figures.filter((figure) => !figure.rangeFigure)}
                minCount={statistics.minCount}
              />
            </section>
            {shownMetricGroups(statistics.counts).map((group, index) => (
              <section key={group.heading} aria-labelledby={`network-group-${index}`} className="grid gap-4">
                <h3 id={`network-group-${index}`} className="text-h3">
                  {group.heading}
                </h3>
                {group.metrics.map((metric) => (
                  <ResultsTable key={metric.key} caption={`${group.heading}: ${metric.label}`} columns={["Period", "Count", "Change"]}>
                    {metricRows(statistics.counts, metric.key, query.period, statistics.statesFrom).map((row) => (
                      <tr key={row.periodStart}>
                        <th scope="row" className={rowHead}>
                          {periodLabel(row.periodStart, query.period)}
                        </th>
                        <td className={cell}>{row.unknown ? "-" : countText(row.count, statistics.minCount)}</td>
                        <td className={cell}>{row.trend}</td>
                      </tr>
                    ))}
                  </ResultsTable>
                ))}
              </section>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
