"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toastError, toastNetworkError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { InvitationLink } from "@/components/team/invitation-link";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { inviteMember, type InviteResult } from "@/lib/actions/team";
import { isRedirectError } from "@/lib/redirect-error";
import { memberLimitMessage, type InvitableRole } from "@/lib/validation/team";

type ResendInvitationProps = { slug: string; email: string; role: InvitableRole };

// A new invitation replaces the expired one, so the person gets a new link.
export function ResendInvitation({ slug, email, role }: ResendInvitationProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState<NonNullable<InviteResult["invitation"]> | null>(null);

  function resend() {
    startTransition(async () => {
      try {
        const result = await inviteMember({ slug, email, role });
        if (result.invitation) {
          setCreated(result.invitation);
          return;
        }
        const description = result.limitReached
          ? memberLimitMessage(result.limitReached.limit)
          : (result.message ?? result.errors?.email);
        toastError("Could not resend the invitation", description);
      } catch (error) {
        if (isRedirectError(error)) return;
        toastNetworkError("Could not resend the invitation");
      }
    });
  }

  function close() {
    setCreated(null);
    router.refresh();
  }

  return (
    <>
      <FormButton type="button" variant="secondary" busy={pending} onClick={resend}>
        Resend<span className="sr-only"> invitation to {email}</span>
      </FormButton>
      <ModalDialog open={created !== null} onClose={() => created && close()} title="Invitation link">
        {created ? <InvitationLink {...created} email={email} role={role} onDone={close} /> : null}
      </ModalDialog>
    </>
  );
}
