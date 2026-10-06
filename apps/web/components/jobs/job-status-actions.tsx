"use client";

import { useState } from "react";
import { FormButton } from "@/components/forms/form-button";
import { ModalDialog } from "@/components/team/modal-dialog";
import { useTeamCall } from "@/components/team/use-team-call";
import { changeJobStatus } from "@/lib/actions/jobs";
import { statusActions, type StatusAction } from "@/lib/jobs/lifecycle";
import type { Database } from "@chara-pinnacle/db-types";

type JobStatusActionsProps = { slug: string; jobId: string; status: Database["public"]["Enums"]["job_status"] };

// One button per change the vacancy allows in its status; Close and Mark as filled ask first. The page is refreshed by
// the action, so the buttons follow the new status.
export function JobStatusActions({ slug, jobId, status }: JobStatusActionsProps) {
  const [confirming, setConfirming] = useState<StatusAction | null>(null);
  const call = useTeamCall("The status was not changed");
  const actions = statusActions[status];

  function run(action: StatusAction) {
    call.run(() => changeJobStatus(slug, jobId, action.to), action.done, () => setConfirming(null));
  }

  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {actions.map((action) => (
        <FormButton
          key={action.to}
          type="button"
          variant={action.to === "open" ? "primary" : "secondary"}
          className="w-auto"
          busy={call.pending && !action.confirm}
          disabled={call.pending}
          onClick={() => (action.confirm ? setConfirming(action) : run(action))}
        >
          {action.label}
        </FormButton>
      ))}
      <ModalDialog open={confirming !== null} onClose={() => setConfirming(null)} title={confirming?.confirm?.title ?? ""}>
        <p className="text-body leading-relaxed">{confirming?.confirm?.body}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormButton type="button" variant="secondary" className="w-full" onClick={() => setConfirming(null)}>
            Cancel
          </FormButton>
          <FormButton type="button" busy={call.pending} onClick={() => confirming && run(confirming)}>
            {confirming?.confirm?.button}
          </FormButton>
        </div>
      </ModalDialog>
    </div>
  );
}
