import { cell, ResultsTable } from "@/components/admin/results-table";
import { partnerSearchCounts, type PartnerSearchKind } from "@/lib/dal/admin";

function share(part: number, whole: number): string {
  return whole === 0 ? "-" : `${Math.round((part / whole) * 100)} %`;
}

const searchLabels: Record<PartnerSearchKind, string> = {
  recruitment: "Recruitment partner searches",
  staffing: "Staffing partner searches",
  available_workforce: "Available workforce searches",
};

// The KPIs of Find Recruitment Partners (FR-L1), Find Staffing Partners (FR-L2) and the available workforce search
// (FR-K3): searches with at least one result and zero-result searches by destination, from the search log, which holds
// nothing personal.
export async function PartnerSearchCounts({ kind, from, to }: { kind: PartnerSearchKind; from: string; to: string }) {
  const counts = await partnerSearchCounts(kind, from, to);
  const label = searchLabels[kind];
  return (
    <div className="grid gap-4">
      <ResultsTable caption={`${label} from ${from} to ${to}`} columns={["Searches", "Count", "Share"]}>
        <tr>
          <td className={cell}>With at least one result</td>
          <td className={cell}>{counts.withResults}</td>
          <td className={cell}>{share(counts.withResults, counts.searches)}</td>
        </tr>
        <tr>
          <td className={cell}>Without results</td>
          <td className={cell}>{counts.zeroResults}</td>
          <td className={cell}>{share(counts.zeroResults, counts.searches)}</td>
        </tr>
        <tr className="font-medium">
          <td className={cell}>All searches</td>
          <td className={cell}>{counts.searches}</td>
          <td className={cell}>{counts.searches === 0 ? "-" : "100 %"}</td>
        </tr>
      </ResultsTable>
      <ResultsTable caption={`${label} without results by destination from ${from} to ${to}`} columns={["Destination", "Searches without results"]}>
        {counts.zeroByDestination.length === 0 ? (
          <tr>
            <td className={cell} colSpan={2}>
              No search with a destination was without results.
            </td>
          </tr>
        ) : (
          counts.zeroByDestination.map((row) => (
            <tr key={row.code}>
              <td className={cell}>{row.name}</td>
              <td className={cell}>{row.searches}</td>
            </tr>
          ))
        )}
      </ResultsTable>
    </div>
  );
}
