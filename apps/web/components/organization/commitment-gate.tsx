"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { Notice } from "@/components/forms/notice";
import { LegalLink } from "@/components/forms/text-link";
import { CommitmentForm } from "@/components/organization/commitment-form";
import { formatDate } from "@/lib/i18n/format";
import { COMMITMENT_SLUG, commitmentBlockedText, type CommitmentBlock } from "@/lib/validation/commitment";
import { displayTitle } from "@/lib/validation/consents";

type CommitmentGateProps = {
  slug: string;
  owner: boolean;
  commitment: CommitmentBlock;
  // The id of the sentence that says why, which the blocked Respond or Send buttons name as their description.
  reasonId: string;
};

// The employer-pays commitment is not accepted in its current version, so the partner cannot respond to job orders or
// submit candidates (FR-J3 AC4, FR-S4 AC7, NFR-U4). An admin or a member reads why and that the owner acts, as a status
// message. The owner reads the same with Review and accept, which opens the dialog with the version and the
// confirmation; after a new version (an earlier one accepted) the dialog opens at once with what changed. It holds the
// focus until it is accepted or put off with Not now. A commitment never accepted (a company in onboarding, or a new owner
// after a transfer) does not open it by itself: onboarding asks for it in its own step.
export function CommitmentGate({ slug, owner, commitment, reasonId }: CommitmentGateProps) {
  const reason = commitmentBlockedText(owner, commitment.outdated);
  if (!owner) {
    return (
      <Notice tone="warning" role="status">
        <p id={reasonId} className="font-medium">
          {reason}
        </p>
      </Notice>
    );
  }
  return <OwnerGate slug={slug} commitment={commitment} reason={reason} reasonId={reasonId} />;
}

function OwnerGate({ slug, commitment, reason, reasonId }: { slug: string; commitment: CommitmentBlock; reason: string; reasonId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(commitment.outdated);
  const title = displayTitle(commitment.title);

  function accepted() {
    setOpen(false);
    toast({ title: "Commitment accepted", description: "Your company can respond to job orders and submit candidates again." });
    router.refresh();
  }

  return (
    <>
      <Notice tone="warning" role="status">
        <p id={reasonId} className="font-medium">
          {reason}
        </p>
        <FormButton type="button" variant="secondary" className="mt-3 w-auto" onClick={() => setOpen(true)}>
          Review and accept
        </FormButton>
      </Notice>
      <ModalDialog
        open={open}
        onClose={() => setOpen(false)}
        title={commitment.outdated ? "The employer-pays commitment has changed" : "Accept the employer-pays commitment"}
      >
        <div className="grid gap-2 text-body leading-relaxed">
          <p className="text-small text-muted-foreground">
            {title}, version {commitment.version} · {formatDate(commitment.publishedAt)}
            {commitment.isDraft ? " · Draft - not yet approved by legal counsel" : ""}
          </p>
          {commitment.outdated ? (
            <p>
              <span className="font-medium">What changed:</span> {commitment.changeSummary}
            </p>
          ) : null}
          <p>Until you accept it, your company cannot respond to job orders or submit candidates.</p>
          <LegalLink slug={COMMITMENT_SLUG} newTabLabel={`of the ${title} (opens in a new tab)`} standalone>
            Read the full text
          </LegalLink>
        </div>
        <CommitmentForm slug={slug} version={commitment.version} onAccepted={accepted} />
        <FormButton type="button" variant="secondary" className="w-auto justify-self-start" onClick={() => setOpen(false)}>
          Not now
        </FormButton>
      </ModalDialog>
    </>
  );
}
