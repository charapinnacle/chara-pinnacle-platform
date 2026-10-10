"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { FormButton } from "@/components/forms/form-button";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import type { StageChangeProps } from "@/components/applicants/stage-change-form";

// The form (React Hook Form, the resolver and the schema) is fetched when the dialog first opens, not with the page.
const StageChangeForm = dynamic(
  () => import("@/components/applicants/stage-change-form").then((module) => module.StageChangeForm),
  { ssr: false, loading: () => <LoadingSkeleton rows={2} /> },
);

type StageChangeDialogProps = StageChangeProps & { open: boolean; onClose: () => void; title?: string };

export function StageChangeDialog({ open, onClose, title = "Change stage", ...props }: StageChangeDialogProps) {
  return (
    <ModalDialog open={open} onClose={onClose} title={title}>
      <StageChangeForm {...props} onClose={onClose} />
    </ModalDialog>
  );
}

export function StageChange(props: StageChangeProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FormButton type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        Change stage
      </FormButton>
      <StageChangeDialog {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
