"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Checkbox } from "@/components/forms/checkbox";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import { formatShortDate } from "@/lib/i18n/format";
import { employerSubmissionPath } from "@/lib/routes";
import {
  employerSubmissionLabels,
  submissionTones,
  submittedByLabel,
  type PipelineSubmissionStage,
} from "@/lib/submissions/presentation";

// The bulk form (React Hook Form, the resolver and the schemas) is fetched after the page, not with it: the list and the
// board are readable before the bulk actions are, and the applicants route stays within its first-load budget.
const SubmissionBulkActions = dynamic(
  () => import("@/components/submissions/submission-bulk-actions").then((module) => module.SubmissionBulkActions),
  { ssr: false, loading: () => <LoadingSkeleton rows={2} /> },
);

export type PipelineRow = {
  id: string;
  candidateName: string;
  partnerName: string;
  requirementTitle: string | null;
  status: PipelineSubmissionStage;
  approvedAt: string;
  stageChangedAt: string | null;
};

type SubmissionPipelineProps = {
  lang: string;
  slug: string;
  view: "list" | "board";
  rows: PipelineRow[];
  frozen: boolean;
  shortlisting: boolean;
  noteMaxChars: number;
};

// The submitted candidates of the pipeline (FR-O5 AC1) as a list or as a board in the stage order of direct applicants,
// each marked "Submitted by <partner>", with the bulk action of AC8 (SubmissionBulkActions).
export function SubmissionPipeline({ lang, slug, view, rows, frozen, shortlisting, noteMaxChars }: SubmissionPipelineProps) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const selected = rows.filter((row) => selectedIds.has(row.id));
  const selectable = !frozen;

  function toggle(id: string, on: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function selectBox(row: PipelineRow) {
    return selectable ? (
      <label className="-m-2 grid cursor-pointer place-items-center p-2">
        <Checkbox
          aria-label={`Select ${row.candidateName}`}
          checked={selectedIds.has(row.id)}
          onChange={(event) => toggle(row.id, event.target.checked)}
        />
      </label>
    ) : null;
  }

  return (
    <div className="grid gap-4">
      {selectable ? (
        <SubmissionBulkActions
          slug={slug}
          shortlisting={shortlisting}
          noteMaxChars={noteMaxChars}
          selected={selected}
          onMoved={(moved) => setSelectedIds((current) => new Set([...current].filter((id) => !moved.has(id))))}
        />
      ) : null}

      {view === "board" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2" role="region" aria-label="Board" tabIndex={0}>
          <div className="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3">
            {Object.keys(employerSubmissionLabels).map((stage) => {
              const columnRows = rows.filter((row) => row.status === stage);
              const label = employerSubmissionLabels[stage as PipelineSubmissionStage];
              return (
                <Card as="section" key={stage} aria-label={`${label}, ${columnRows.length}`} padding="sm" className="content-start gap-2">
                  <h2 className="flex items-center justify-between gap-2 text-h3">
                    {label}
                    <span className="text-small font-normal text-muted-foreground">{columnRows.length}</span>
                  </h2>
                  {columnRows.length === 0 ? (
                    <p className="text-small text-muted-foreground">No candidates</p>
                  ) : (
                    <ul className="grid gap-2">
                      {columnRows.map((row) => (
                        <li key={row.id} className="grid grid-cols-[auto_1fr] items-start gap-2 rounded-lg border bg-background p-3">
                          {selectBox(row) ?? <span />}
                          <div className="grid min-w-0 gap-0.5">
                            <TextLink href={employerSubmissionPath(lang, slug, row.id)} className="font-medium wrap-anywhere">
                              {row.candidateName}
                            </TextLink>
                            <p className="text-small text-muted-foreground wrap-anywhere">{submittedByLabel(row.partnerName)}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      ) : (
        <ul className="grid gap-3" aria-label="Submitted candidates">
          {rows.map((row) => (
            <Card as="li" key={row.id} padding="sm" className="grid-cols-[auto_1fr] items-start gap-3 sm:grid-cols-[auto_1fr_auto]">
              {selectBox(row) ?? <span />}
              <div className="grid min-w-0 gap-0.5">
                <TextLink href={employerSubmissionPath(lang, slug, row.id)} className="font-medium wrap-anywhere">
                  {row.candidateName}
                </TextLink>
                <p className="text-small wrap-anywhere">{submittedByLabel(row.partnerName)}</p>
                {row.requirementTitle ? <p className="text-small text-muted-foreground wrap-anywhere">{row.requirementTitle}</p> : null}
                <p className="text-small text-muted-foreground">
                  Submitted <time dateTime={row.approvedAt}>{formatShortDate(row.approvedAt)}</time>
                  {row.stageChangedAt ? (
                    <>
                      {" · "}Last change <time dateTime={row.stageChangedAt}>{formatShortDate(row.stageChangedAt)}</time>
                    </>
                  ) : null}
                </p>
              </div>
              <p className="col-start-2 sm:col-start-3">
                <StatusBadge status={submissionTones[row.status]}>{employerSubmissionLabels[row.status]}</StatusBadge>
              </p>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
