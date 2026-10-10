"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BoardCard, moveButtonId } from "@/components/applicants/board-card";
import { StageChangeDialog } from "@/components/applicants/stage-change";
import { StatusBadge } from "@/components/feedback/status-badge";
import { TextLink } from "@/components/forms/text-link";
import { useActionCall } from "@/components/feedback/use-action-call";
import { Card } from "@/components/layout/card";
import { changeApplicantStage, readBoardCounts } from "@/lib/actions/applicants";
import { moveCard } from "@/lib/applicants/board";
import { applicationStatusLabels, FORMER_CANDIDATE } from "@/lib/applications/presentation";
import { allowedTargets } from "@/lib/applications/stage-machine";
import type { ApplicantRow, BoardColumn } from "@/lib/dal/applicant-list";
import { applicantPath, applicantsPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

type Status = ApplicantRow["status"];

type BoardProps = {
  lang: string;
  slug: string;
  jobId: string;
  columns: BoardColumn[];
  frozen: boolean;
  shortlisting: boolean;
  noteMaxChars: number;
};

const POLL_MS = 5_000;
const IDLE_MS = 5 * 60_000;

// The board is the page's data plus the moves not yet confirmed by the server. A new read of the page replaces it, so a
// move the server refused (a stale card, a lapsed plan) disappears with the next refresh. Other members' moves arrive by
// polling the count of each stage every 5 seconds, and the page is read again only when a count differs (a move or a new
// application always changes one). It polls only while the tab is visible, nothing here is being changed and the member
// has touched the page in the last 5 minutes. A poll that fails waits for the next one: the board shows what it had.
export function Board({ lang, slug, jobId, columns, frozen, shortlisting, noteMaxChars }: BoardProps) {
  const router = useRouter();
  const [source, setSource] = useState(columns);
  const [shown, setShown] = useState(columns);
  const [dragging, setDragging] = useState<ApplicantRow | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const [declining, setDeclining] = useState<ApplicantRow | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const focusAfter = useRef<string | null>(null);
  const call = useActionCall("The stage was not changed");
  if (source !== columns) {
    setSource(columns);
    setShown(columns);
  }

  useEffect(() => {
    if (call.pending || declining) return;
    let active = true;
    let lastInput = Date.now();
    const noteInput = () => {
      lastInput = Date.now();
    };
    const inputs = ["pointerdown", "pointermove", "keydown"] as const;
    for (const input of inputs) window.addEventListener(input, noteInput, { passive: true });
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible" || Date.now() - lastInput > IDLE_MS) return;
      const counts = await readBoardCounts(jobId).catch(() => null);
      if (active && counts && columns.some((column) => counts[column.status] !== column.total)) router.refresh();
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
      for (const input of inputs) window.removeEventListener(input, noteInput);
    };
  }, [router, jobId, columns, call.pending, declining]);

  useEffect(() => {
    const id = focusAfter.current;
    focusAfter.current = null;
    if (id) document.getElementById(moveButtonId(id))?.focus();
  });

  const targetsOf = (row: ApplicantRow) => (frozen ? [] : allowedTargets(row.status, "employer", { shortlisting }));

  function move(row: ApplicantRow, target: Status) {
    if (target === "rejected") {
      setDeclining(row);
      return;
    }
    const name = row.candidateName ?? FORMER_CANDIDATE;
    setShown((current) => moveCard(current, row.id, target));
    focusAfter.current = row.id;
    call.run(
      async () => {
        const result = await changeApplicantStage(slug, row.id, { status: target, note: "" });
        if (result.done) setAnnouncement(`${name} moved to ${applicationStatusLabels[target]}`);
        return result;
      },
      `Stage changed to ${applicationStatusLabels[target]}`,
      () => router.refresh(),
    );
  }

  function closeDecline() {
    if (declining) focusAfter.current = declining.id;
    setDeclining(null);
    router.refresh();
  }

  return (
    <>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <div role="region" aria-label="Pipeline board" tabIndex={0} className="overflow-x-auto pb-2">
        <div className="flex min-w-max items-start gap-3">
          {shown.map((column) => {
            const accepts = dragging !== null && targetsOf(dragging).includes(column.status);
            return (
              <Card
                key={column.status}
                padding="sm"
                role="group"
                aria-labelledby={`column-${column.status}`}
                onDragOver={(event) => {
                  if (!accepts) return;
                  event.preventDefault();
                  setOver(column.status);
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  setOver(null);
                  if (dragging && accepts) move(dragging, column.status);
                  setDragging(null);
                }}
                className={cn("w-64 shrink-0 bg-muted/40", over === column.status && "border-primary ring-2 ring-primary/30")}
              >
                <h2 id={`column-${column.status}`} className="flex items-center justify-between gap-2 text-h3">
                  {applicationStatusLabels[column.status]}
                  <StatusBadge className="bg-card py-0">{column.total}</StatusBadge>
                </h2>
                {column.rows.length === 0 ? (
                  <p className="text-small text-muted-foreground">No applicants</p>
                ) : (
                  <ul className="grid gap-2">
                    {column.rows.map((row) => (
                      <BoardCard
                        key={row.id}
                        row={row}
                        href={applicantPath(lang, slug, row.id)}
                        targets={allowedTargets(row.status, "employer", { shortlisting })}
                        frozen={frozen}
                        onMove={move}
                        onDragStart={setDragging}
                        onDragEnd={() => setDragging(null)}
                      />
                    ))}
                  </ul>
                )}
                {column.total > column.rows.length ? (
                  <TextLink href={applicantsPath(lang, slug, { job: jobId, stage: column.status })} className="text-small">
                    Show all {column.total} in the list
                  </TextLink>
                ) : null}
              </Card>
            );
          })}
        </div>
      </div>
      <StageChangeDialog
        open={declining !== null}
        onClose={closeDecline}
        title="Not selected"
        slug={slug}
        applicationId={declining?.id ?? ""}
        applicantName={declining?.candidateName ?? FORMER_CANDIDATE}
        targets={declining ? targetsOf(declining) : []}
        noteMaxChars={noteMaxChars}
        initialStatus="rejected"
      />
    </>
  );
}
