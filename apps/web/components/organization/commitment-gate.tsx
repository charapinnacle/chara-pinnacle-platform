import { Notice } from "@/components/forms/notice";
import { CommitmentOwnerGate } from "@/components/organization/commitment-owner-gate";
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
// after a transfer) does not open it by itself: onboarding asks for it in its own step. The texts are made here, on the
// server, so the dashboard ships neither the validation module nor the form until the owner opens the dialog.
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
  return (
    <CommitmentOwnerGate
      slug={slug}
      commitment={commitment}
      title={displayTitle(commitment.title)}
      legalSlug={COMMITMENT_SLUG}
      reason={reason}
      reasonId={reasonId}
    />
  );
}
