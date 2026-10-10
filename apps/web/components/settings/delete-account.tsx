"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FormButton } from "@/components/forms/form-button";
import { Notice } from "@/components/forms/notice";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { useActionCall } from "@/components/feedback/use-action-call";
import { cancelAccountDeletion, requestAccountDeletion } from "@/lib/actions/account-closure";
import type { DeletionStatus } from "@/lib/dal/account-closure";
import { formatIsoDate } from "@/lib/i18n/format";

export function DeleteAccount({ requestedAt, erasesOn, canCancel, coolingOffDays }: DeletionStatus) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const request = useActionCall("Could not request the deletion");
  const cancel = useActionCall("Could not cancel the deletion");
  const banner = useRef<HTMLDivElement>(null);
  const focusBanner = useRef(false);

  useEffect(() => {
    if (requestedAt && focusBanner.current) {
      focusBanner.current = false;
      banner.current?.focus();
    }
  }, [requestedAt]);

  if (requestedAt && erasesOn) {
    return (
      <div className="grid gap-4">
        <Notice ref={banner} tabIndex={-1} tone="info" role="status" className="outline-none">
          Deletion requested on {formatIsoDate(requestedAt)}. Your data will be erased on {formatIsoDate(erasesOn)}.
          {canCancel ? null : " The time to cancel is over and the erasure is in progress."}
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
            variant="destructive"
            busy={request.pending}
            onClick={() =>
              request.run(requestAccountDeletion, "Deletion requested", () => {
                focusBanner.current = true;
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
