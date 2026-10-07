import type { ApplicantRow, BoardColumn } from "@/lib/dal/applicant-list";

type Status = ApplicantRow["status"];

// The board as it will be once a move is accepted: the card leaves its column and joins the target in its place by date,
// and the two counts follow. The server stays the judge; the next read replaces this.
export function moveCard(columns: readonly BoardColumn[], id: string, to: Status): BoardColumn[] {
  const card = columns.flatMap((column) => column.rows).find((row) => row.id === id);
  if (!card || card.status === to) return [...columns];
  return columns.map((column) => {
    if (column.status === card.status) {
      return { ...column, total: column.total - 1, rows: column.rows.filter((row) => row.id !== id) };
    }
    if (column.status === to) {
      const rows = [...column.rows, { ...card, status: to }].sort(
        (a, b) => b.appliedAt.localeCompare(a.appliedAt) || b.id.localeCompare(a.id),
      );
      return { ...column, total: column.total + 1, rows };
    }
    return column;
  });
}
