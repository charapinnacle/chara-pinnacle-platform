"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { Notice } from "@/components/forms/notice";
import { formatDate } from "@/lib/i18n/format";
import { roleLabels, type MemberRole } from "@/lib/validation/team";

type InvitationLinkProps = {
  path: string;
  email: string;
  role: MemberRole;
  expiresAt: string;
  onDone: () => void;
};

// The link holds the only copy of the token outside the invitee's inbox, so it is shown here and never again.
export function InvitationLink({ path, email, role, expiresAt, onDone }: InvitationLinkProps) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}${path}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      toastError("Could not copy the link", "Select the link and copy it by hand.");
    }
  }

  return (
    <div className="grid gap-4">
      <Notice tone="info" role="status">
        We are emailing the invitation to {email}. If it does not arrive, copy the link now and send it to them yourself: it is shown only once.
      </Notice>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
        <dt className="text-muted-foreground">Role</dt>
        <dd>{roleLabels[role]}</dd>
        <dt className="text-muted-foreground">Expires on</dt>
        <dd>{formatDate(expiresAt)}</dd>
      </dl>
      <input
        readOnly
        autoFocus
        aria-label="Invitation link"
        value={link}
        onFocus={(event) => event.currentTarget.select()}
        className="h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3.5 text-base"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" className="w-full" onClick={copy}>
          {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
          {copied ? "Copied" : "Copy link"}
        </FormButton>
        <FormButton type="button" onClick={onDone}>
          Done
        </FormButton>
      </div>
    </div>
  );
}
