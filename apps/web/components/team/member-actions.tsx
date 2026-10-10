"use client";

import { useState } from "react";
import { FormButton } from "@/components/forms/form-button";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { useActionCall } from "@/components/feedback/use-action-call";
import { changeMemberRole, removeMember } from "@/lib/actions/team";
import type { InvitableRole } from "@/lib/validation/team";

type MemberActionsProps = { slug: string; userId: string; name: string; role: InvitableRole };

export function MemberActions({ slug, userId, name, role }: MemberActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const roleCall = useActionCall("Could not change the role");
  const removeCall = useActionCall("Could not remove the member");
  const target = role === "member" ? "admin" : "member";

  return (
    <div className="flex flex-wrap gap-2">
      <FormButton
        type="button"
        variant="secondary"
        busy={roleCall.pending}
        onClick={() =>
          roleCall.run(
            () => changeMemberRole({ slug, userId, role: target }),
            target === "admin" ? `${name} is now an administrator` : `${name} is now a member`,
          )
        }
      >
        {target === "admin" ? "Make administrator" : "Make member"}
        <span className="sr-only"> for {name}</span>
      </FormButton>
      <FormButton type="button" variant="secondary" onClick={() => setConfirming(true)}>
        Remove<span className="sr-only"> {name}</span>
      </FormButton>
      <ModalDialog open={confirming} onClose={() => setConfirming(false)} title={`Remove ${name}?`}>
        <p className="text-body leading-relaxed">
          {name} loses access to this organization at once and is signed out of CHARA.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormButton type="button" variant="secondary" className="w-full" onClick={() => setConfirming(false)}>
            Cancel
          </FormButton>
          <FormButton
            type="button"
            variant="destructive"
            busy={removeCall.pending}
            onClick={() => removeCall.run(() => removeMember({ slug, userId }), `${name} was removed`, () => setConfirming(false))}
          >
            Remove member
          </FormButton>
        </div>
      </ModalDialog>
    </div>
  );
}
