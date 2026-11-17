"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { toast } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { Notice } from "@/components/forms/notice";
import { LegalLink } from "@/components/forms/text-link";
import { formatDate } from "@/lib/i18n/format";
import type { CommitmentBlock } from "@/lib/validation/commitment";

// The form (React Hook Form, the resolver and the schema) is fetched when the dialog opens, not with the dashboard.
const CommitmentForm = dynamic(() => import("@/components/organization/commitment-form").then((module) => module.CommitmentForm), {
  ssr: false,
  loading: () => <LoadingSkeleton rows={2} />,
});

type CommitmentOwnerGateProps = {
  slug: string;
  commitment: CommitmentBlock;
  title: string;
  legalSlug: string;
  reason: string;
  reasonId: string;
};

export function CommitmentOwnerGate({ slug, commitment, title, legalSlug, reason, reasonId }: CommitmentOwnerGateProps) {
  const router = useRouter();
  const [open, setOpen] = useState(commitment.outdated);

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
          <LegalLink slug={legalSlug} newTabLabel={`of the ${title} (opens in a new tab)`} standalone>
            Read the full text
          </LegalLink>
        </div>
        {open ? <CommitmentForm slug={slug} version={commitment.version} onAccepted={accepted} /> : null}
        <FormButton type="button" variant="secondary" className="w-auto justify-self-start" onClick={() => setOpen(false)}>
          Not now
        </FormButton>
      </ModalDialog>
    </>
  );
}
