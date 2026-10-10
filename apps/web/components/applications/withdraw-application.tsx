"use client";

import { useState } from "react";
import { FormButton } from "@/components/forms/form-button";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { useActionCall } from "@/components/feedback/use-action-call";
import { withdrawMyApplication } from "@/lib/actions/applications";

type WithdrawApplicationProps = { applicationId: string; jobTitle: string; employerName: string };

function WithdrawBody({ applicationId, jobTitle, employerName, onClose }: WithdrawApplicationProps & { onClose: () => void }) {
  const withdraw = useActionCall("The application was not withdrawn");
  return (
    <>
      <p className="text-body leading-relaxed wrap-anywhere">
        Your application for {jobTitle} at {employerName}.
      </p>
      <p className="text-body leading-relaxed">
        The employer loses access to your documents immediately. You can apply again while the vacancy is open.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" className="w-full" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton
          type="button"
          variant="destructive"
          busy={withdraw.pending}
          onClick={() => withdraw.run(() => withdrawMyApplication(applicationId), "Application withdrawn", onClose)}
        >
          {withdraw.pending ? "Withdrawing" : "Withdraw"}
        </FormButton>
      </div>
    </>
  );
}

export function WithdrawApplication(props: WithdrawApplicationProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FormButton type="button" variant="secondary" className="w-auto justify-self-start" onClick={() => setOpen(true)}>
        Withdraw application
      </FormButton>
      <ModalDialog open={open} onClose={() => setOpen(false)} title="Withdraw this application?">
        <WithdrawBody {...props} onClose={() => setOpen(false)} />
      </ModalDialog>
    </>
  );
}
