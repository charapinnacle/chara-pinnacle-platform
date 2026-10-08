"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ApplicantRow } from "@/lib/dal/applicant-list";

export type SelectableRow = { id: string; name: string; status: ApplicantRow["status"] };

type Selection = {
  selected: SelectableRow[];
  isSelected: (id: string) => boolean;
  toggle: (id: string, on: boolean) => void;
  deselect: (ids: readonly string[]) => void;
};

const SelectionContext = createContext<Selection | null>(null);

// The applicants ticked on the page, shared by the list or the board and the toolbar. Only ids are kept: the name and the
// stage come from the rows of the latest read of the page, so a refresh shows the current stage, and an id that is no
// longer on the page (another filter, a card pushed off a board column) is no longer selected. Without `rows` there are
// no boxes, as on a page whose organization may not change stages.
export function BulkSelection({ rows, children }: { rows: SelectableRow[] | null; children: React.ReactNode }) {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const value = useMemo<Selection | null>(() => {
    if (!rows) return null;
    return {
      selected: rows.filter((row) => ids.has(row.id)),
      isSelected: (id) => ids.has(id),
      toggle: (id, on) =>
        setIds((current) => {
          const next = new Set(current);
          if (on) next.add(id);
          else next.delete(id);
          return next;
        }),
      deselect: (done) => setIds((current) => new Set([...current].filter((id) => !done.includes(id)))),
    };
  }, [rows, ids]);
  return <SelectionContext value={value}>{children}</SelectionContext>;
}

export function useBulkSelection(): Selection | null {
  return useContext(SelectionContext);
}

export function SelectApplicant({ id, name }: { id: string; name: string }) {
  const selection = useBulkSelection();
  if (!selection) return null;
  return (
    <input
      type="checkbox"
      aria-label={`Select ${name}`}
      checked={selection.isSelected(id)}
      onChange={(event) => selection.toggle(id, event.target.checked)}
      className="size-5 shrink-0 cursor-pointer accent-primary"
    />
  );
}
