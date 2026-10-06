"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormButton } from "@/components/forms/form-button";
import { Notice } from "@/components/forms/notice";
import { ModalDialog } from "@/components/team/modal-dialog";
import { useTeamCall } from "@/components/team/use-team-call";
import { cancelAccountDeletion, requestAccountDeletion } from "@/lib/actions/account-closure";
import type { DeletionStatus } from "@/lib/dal/account-closure";
import { formatIsoDate } from "@/lib/i18n/format";

export function DeleteAccount({ requestedAt, erasesOn, canCancel, coolingOffDays }: DeletionStatus) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const request = useTeamCall("Could not request the deletion");
  const cancel = useTeamCall("Could not cancel the deletion");

  if (requestedAt && erasesOn) {
    return (
      <div className="grid gap-4">
        <Notice tone="info" role="status">
          Deletion requested on {formatIsoDate(requestedAt)}. Your data will be erased on {formatIsoDate(erasesOn)}.
        </Notice>
        {canCancel ? (
          <FormButton
            type="button"
            variant="secondary"
            className="w-full sm:w-auto"
            busy={cancel.pending}
            onClick={() => cancel.run(cancelAccountDeletion, "Deletion cancelled", () => router.refresh())}
          >
            Cancel deletion
          </FormButton>
        ) : null}
      </div>
    );
  }

  function close() {
    setOpen(false);
  }

  return (
    <>
      <FormButton type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        Delete account
      </FormButton>
      <ModalDialog open={open} onClose={close} title="Delete your account?">
        <p className="text-body leading-relaxed">
          Your profile and documents will be erased in {coolingOffDays} days. Your applications stay for employers, without
          your name. You can cancel at any time until then.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormButton type="button" variant="secondary" className="w-full" onClick={close}>
            Cancel
          </FormButton>
          <FormButton
            type="button"
            busy={request.pending}
            onClick={() =>
              request.run(requestAccountDeletion, "Deletion requested", () => {
                close();
                router.refresh();
              })
            }
          >
            Request deletion
          </FormButton>
        </div>
      </ModalDialog>
    </>
  );
}
