"use client";

import { useState } from "react";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { useActionCall } from "@/components/feedback/use-action-call";
import { FormButton } from "@/components/forms/form-button";
import { withdrawInvitation } from "@/lib/actions/invitations";

type WithdrawInvitationButtonProps = { slug: string; requirementId: string; invitationId: string; partnerName: string };

// Withdraw for one invitation that has no response yet (FR-O1 step Withdraw, AC10), after a confirmation: withdrawing
// tells the partner and cannot be undone, and the partner cannot be invited to this requirement again.
export function WithdrawInvitationButton({ slug, requirementId, invitationId, partnerName }: WithdrawInvitationButtonProps) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useActionCall("The invitation was not withdrawn");
  const close = () => setOpen(false);
  return (
    <>
      <FormButton type="button" variant="secondary" className="w-auto" onClick={() => setOpen(true)}>
        Withdraw<span className="sr-only normal-case"> the invitation of {partnerName}</span>
      </FormButton>
      <ModalDialog open={open} onClose={close} title={`Withdraw the invitation of ${partnerName}?`}>
        <p className="text-body leading-relaxed">
          {partnerName} is told that the invitation was withdrawn and can no longer answer it. This cannot be undone, and the
          partner cannot be invited to this requirement again. A withdrawn invitation no longer counts against your plan.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormButton type="button" variant="secondary" className="w-full" onClick={close}>
            Cancel
          </FormButton>
          <FormButton
            type="button"
            variant="destructive"
            busy={pending}
            onClick={() =>
              run(() => withdrawInvitation(slug, { requirementId, invitationId }), `The invitation of ${partnerName} is withdrawn`, close)
            }
          >
            Withdraw invitation
          </FormButton>
        </div>
      </ModalDialog>
    </>
  );
}
