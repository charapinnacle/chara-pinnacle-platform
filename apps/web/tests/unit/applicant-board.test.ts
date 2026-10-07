import { describe, expect, it } from "vitest";
import { moveCard } from "@/lib/applicants/board";
import type { ApplicantRow, BoardColumn } from "@/lib/dal/applicant-list";
import { pipelineStages } from "@/lib/applications/presentation";

const row = (id: string, status: ApplicantRow["status"], appliedAt: string): ApplicantRow => ({
  id, jobId: "j", jobTitle: "Welder", candidateName: id, status, appliedAt, completeness: 50, documents: 0,
});

function board(rows: ApplicantRow[], totals: Partial<Record<ApplicantRow["status"], number>> = {}): BoardColumn[] {
  return pipelineStages.map((status) => {
    const mine = rows.filter((candidate) => candidate.status === status);
    return { status, total: totals[status] ?? mine.length, rows: mine };
  });
}

const counts = (columns: BoardColumn[]) => Object.fromEntries(columns.map((column) => [column.status, `${column.total}/${column.rows.length}`]));

describe("moveCard", () => {
  const columns = board([row("ana", "applied", "2026-09-04T10:00:00Z"), row("ben", "applied", "2026-09-03T10:00:00Z"), row("chi", "interview", "2026-09-05T10:00:00Z")]);

  it("takes the card out of its column and puts it in the target, and both counts follow", () => {
    const moved = moveCard(columns, "ana", "interview");
    expect(counts(moved)).toMatchObject({ applied: "1/1", interview: "2/2" });
    expect(moved.find((column) => column.status === "interview")?.rows.map((card) => [card.id, card.status])).toEqual([
      ["chi", "interview"],
      ["ana", "interview"],
    ]);
  });

  it("keeps the newest first in the target column", () => {
    const moved = moveCard(columns, "ben", "interview");
    expect(moved.find((column) => column.status === "interview")?.rows.map((card) => card.id)).toEqual(["chi", "ben"]);
    const older = moveCard(board([row("old", "applied", "2026-01-01T00:00:00Z"), row("new", "interview", "2026-09-05T10:00:00Z")]), "old", "interview");
    expect(older.find((column) => column.status === "interview")?.rows.map((card) => card.id)).toEqual(["new", "old"]);
  });

  it("counts the whole stage, not the cards shown", () => {
    const long = board([row("ana", "applied", "2026-09-04T10:00:00Z")], { applied: 40, shortlisted: 7 });
    expect(counts(moveCard(long, "ana", "shortlisted"))).toMatchObject({ applied: "39/0", shortlisted: "8/1" });
  });

  it("changes nothing for an unknown card or the stage the card is in, and does not modify its input", () => {
    expect(moveCard(columns, "nobody", "offer")).toEqual(columns);
    expect(moveCard(columns, "ana", "applied")).toEqual(columns);
    const before = JSON.stringify(columns);
    moveCard(columns, "ana", "offer");
    expect(JSON.stringify(columns)).toBe(before);
  });
});
