"use client";

import { useState } from "react";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import type { PassportResult } from "@/lib/actions/passport";

type ConfirmRemoveButtonProps = { name: string; removed: string; remove: () => Promise<PassportResult> };

// An entry with several fields is removed only after the candidate confirms (FR-Q4 AC8); a one-value item uses RemoveButton.
export function ConfirmRemoveButton({ name, removed, remove }: ConfirmRemoveButtonProps) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useActionCall("Could not remove it");
  return (
    <>
      <FormButton type="button" variant="secondary" onClick={() => setOpen(true)}>
        Remove<span className="sr-only"> {name}</span>
      </FormButton>
      <ModalDialog open={open} onClose={() => setOpen(false)} title={`Remove ${name}?`}>
        <p className="text-body">It is removed from your passport. You can add it again later.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormButton type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </FormButton>
          <FormButton type="button" variant="destructive" busy={pending} onClick={() => run(remove, removed, () => setOpen(false))}>
            Remove
          </FormButton>
        </div>
      </ModalDialog>
    </>
  );
}
