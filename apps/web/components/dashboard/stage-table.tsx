import type { Database } from "@chara-pinnacle/db-types";
import { StageBar } from "@/components/dashboard/stage-bar";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { applicationStatusLabels, pipelineStages } from "@/lib/applications/presentation";
import type { StageTotals } from "@/lib/dashboard/stage-counts";
import { formatCount } from "@/lib/i18n/format";

type ApplicationStatus = Database["public"]["Enums"]["application_status"];

type StageTableProps = {
  id: string;
  title: string;
  description: string;
  countLabel: string;
  totals: StageTotals;
  total: number;
  // Each stage links to the list filtered by it, when such a list exists.
  hrefFor?: (stage: ApplicationStatus) => string;
};

// Every stage, a stage with none shown as 0. The table is the chart: a
// bar beside each number shows its share of the largest stage.
export function StageTable({ id, title, description, countLabel, totals, total, hrefFor }: StageTableProps) {
  const max = Math.max(...pipelineStages.map((stage) => totals[stage]));
  return (
    <Card as="section" aria-labelledby={id} padding="lg" elevated className="content-start gap-4">
      <div className="grid gap-0.5">
        <h2 id={id} className="text-h2">
          {title}
        </h2>
        <p className="text-small text-muted-foreground">{description}</p>
      </div>
      <table aria-labelledby={id} className="w-full text-body">
        <thead>
          <tr className="border-b text-small text-muted-foreground">
            <th scope="col" className="py-2 text-start font-medium">
              Stage
            </th>
            <th scope="col" className="py-2 text-end font-medium">
              {countLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {pipelineStages.map((stage) => (
            <tr key={stage} className="border-b last:border-b-0">
              <th scope="row" className="py-2.5 text-start font-normal">
                {hrefFor ? <TextLink href={hrefFor(stage)}>{applicationStatusLabels[stage]}</TextLink> : applicationStatusLabels[stage]}
              </th>
              <td className="py-2.5">
                <span className="flex items-center justify-end gap-4">
                  <StageBar value={totals[stage]} max={max} />
                  <span className="min-w-8 text-end tabular-nums">{formatCount(totals[stage])}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t">
            <th scope="row" className="pt-3 text-start font-medium">
              Total
            </th>
            <td className="pt-3 text-end font-medium tabular-nums">{formatCount(total)}</td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}
