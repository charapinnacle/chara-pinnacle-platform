import { cell, ResultsTable } from "@/components/admin/results-table";
import { countText, dayLabel } from "@/lib/admin/network-statistics";
import { partnerSearchCounts, type PartnerSearchKind } from "@/lib/dal/admin";

// A share only of counts that are shown: a hidden part has a hidden share.
function share(part: number | null, whole: number | null): string {
  return part === null || whole === null || whole === 0 ? "-" : `${Math.round((part / whole) * 100)} %`;
}

const searchLabels: Record<PartnerSearchKind, string> = {
  recruitment: "Recruitment partner searches",
  staffing: "Staffing partner searches",
  available_workforce: "Available workforce searches",
  employers: "Find Employers searches",
};

// The KPIs of Find Recruitment Partners (FR-L1), Find Staffing Partners (FR-L2), the available workforce search (FR-K3)
// and Find Employers (FR-L3): searches with at least one result and zero-result searches by destination, from the search
// log, which holds nothing personal. Counts below the privacy threshold read "fewer than" it, as in the partner network
// figures.
export async function PartnerSearchCounts({ kind, from, to }: { kind: PartnerSearchKind; from: string; to: string }) {
  const counts = await partnerSearchCounts(kind, from, to);
  const label = searchLabels[kind];
  const range = `from ${dayLabel(from)} to ${dayLabel(to)}`;
  const count = (value: number | null) => countText(value, counts.minCount);
  return (
    <div className="grid gap-4">
      <ResultsTable caption={`${label} ${range}`} columns={["Searches", "Count", "Share"]}>
        <tr>
          <td className={cell}>With at least one result</td>
          <td className={cell}>{count(counts.withResults)}</td>
          <td className={cell}>{share(counts.withResults, counts.searches)}</td>
        </tr>
        <tr>
          <td className={cell}>Without results</td>
          <td className={cell}>{count(counts.zeroResults)}</td>
          <td className={cell}>{share(counts.zeroResults, counts.searches)}</td>
        </tr>
        <tr className="font-medium">
          <td className={cell}>All searches</td>
          <td className={cell}>{count(counts.searches)}</td>
          <td className={cell}>{counts.searches === null || counts.searches === 0 ? "-" : "100 %"}</td>
        </tr>
      </ResultsTable>
      <ResultsTable caption={`${label} without results by destination ${range}`} columns={["Destination", "Searches without results"]}>
        {counts.zeroByDestination.length === 0 ? (
          <tr>
            <td className={cell} colSpan={2}>
              No destination has {counts.minCount} or more searches without results.
            </td>
          </tr>
        ) : (
          counts.zeroByDestination.map((row) => (
            <tr key={row.code}>
              <td className={cell}>{row.name}</td>
              <td className={cell}>{count(row.searches)}</td>
            </tr>
          ))
        )}
      </ResultsTable>
    </div>
  );
}
