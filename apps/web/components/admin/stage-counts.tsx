import { cell, ResultsTable } from "@/components/admin/results-table";
import { applicationStatusLabels } from "@/lib/applications/presentation";
import { applicationCounts } from "@/lib/dal/admin";

export async function StageCounts({ from, to }: { from: string; to: string }) {
  const counts = await applicationCounts(from, to);
  const total = counts.reduce((sum, row) => sum + row.count, 0);

  return (
    <ResultsTable caption={`Applications created from ${from} to ${to}`} columns={["Stage", "Applications"]}>
      {counts.map((row) => (
        <tr key={row.status}>
          <td className={cell}>{applicationStatusLabels[row.status]}</td>
          <td className={cell}>{row.count}</td>
        </tr>
      ))}
      <tr className="font-medium">
        <td className={cell}>All stages</td>
        <td className={cell}>{total}</td>
      </tr>
    </ResultsTable>
  );
}
