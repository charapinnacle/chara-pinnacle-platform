import { TextLink } from "@/components/forms/text-link";
import { applicationStatusLabels, pipelineStages } from "@/lib/applications/presentation";
import type { DashboardApplications } from "@/lib/dal/dashboard";
import { applicantsPath } from "@/lib/routes";

type StageTableProps = { lang: string; slug: string; applications: DashboardApplications };

// Every stage, a stage with none shown as 0; each links to the organisation-wide list filtered by that stage.
export function StageTable({ lang, slug, applications }: StageTableProps) {
  return (
    <section aria-labelledby="stage-heading" className="grid gap-3 rounded-xl border bg-card p-5 shadow-card">
      <h2 id="stage-heading" className="text-lg font-semibold">
        Applicants by stage
      </h2>
      <table aria-labelledby="stage-heading" className="w-full text-body">
        <thead>
          <tr className="border-b">
            <th scope="col" className="py-2 text-start font-medium">
              Stage
            </th>
            <th scope="col" className="py-2 text-end font-medium">
              Applicants
            </th>
          </tr>
        </thead>
        <tbody>
          {pipelineStages.map((stage) => (
            <tr key={stage} className="border-b">
              <th scope="row" className="py-2 text-start font-normal">
                <TextLink href={applicantsPath(lang, slug, { stage })}>{applicationStatusLabels[stage]}</TextLink>
              </th>
              <td className="py-2 text-end tabular-nums">{applications.byStage[stage]}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="py-2 text-start font-medium">
              Total
            </th>
            <td className="py-2 text-end font-medium tabular-nums">{applications.total}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
