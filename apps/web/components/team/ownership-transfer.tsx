"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast, toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { SelectField } from "@/components/forms/select-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { useActionCall } from "@/components/feedback/use-action-call";
import { acceptOwnershipTransfer, cancelOwnershipTransfer, transferOwnership } from "@/lib/actions/team";
import { transferFormSchema, type TransferFormInput } from "@/lib/validation/team";

type Candidate = { value: string; label: string };

export function TransferOwnership({ slug, candidates }: { slug: string; candidates: readonly Candidate[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FormButton type="button" variant="secondary" onClick={() => setOpen(true)}>
        Transfer ownership
      </FormButton>
      <ModalDialog open={open} onClose={() => setOpen(false)} title="Transfer ownership">
        <TransferForm slug={slug} candidates={candidates} onClose={() => setOpen(false)} />
      </ModalDialog>
    </>
  );
}

function TransferForm({ slug, candidates, onClose }: { slug: string; candidates: readonly Candidate[]; onClose: () => void }) {
  const form = useForm<TransferFormInput>({
    resolver: zodResolver(transferFormSchema),
    defaultValues: { userId: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "Could not start the transfer" });

  function onSubmit({ userId }: TransferFormInput) {
    const name = candidates.find((candidate) => candidate.value === userId)?.label ?? "the new owner";
    return submit(
      () => transferOwnership({ slug, userId }),
      (result) => {
        onClose();
        if (result.message) {
          toastError("Could not start the transfer", result.message);
          return;
        }
        toast({ title: `Waiting for ${name} to confirm`, description: "Nothing changes until they confirm." });
      },
    );
  }

  return (
    <form noValidate className="grid gap-5" onSubmit={handleSubmit(onSubmit)}>
      <p className="text-body leading-relaxed">
        The person you choose must confirm within 7 days. When they do, they become the owner and you become an
        administrator.
      </p>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={{ userId: "transfer-user" }} />
      <SelectField
        control={control}
        name="userId"
        id="transfer-user"
        label="New owner"
        placeholder="Choose a team member"
        options={candidates}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" className="w-full" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton type="submit" busy={formState.isSubmitting}>
          {formState.isSubmitting ? "Starting transfer..." : "Start transfer"}
        </FormButton>
      </div>
    </form>
  );
}

export function TransferResponse({ slug, mode }: { slug: string; mode: "cancel" | "accept" }) {
  const { pending, run } = useActionCall(mode === "cancel" ? "Could not cancel the transfer" : "Could not confirm the transfer");
  return mode === "cancel" ? (
    <FormButton type="button" variant="secondary" busy={pending} onClick={() => run(() => cancelOwnershipTransfer(slug), "The transfer was cancelled")}>
      Cancel transfer
    </FormButton>
  ) : (
    <FormButton type="button" busy={pending} onClick={() => run(() => acceptOwnershipTransfer(slug), "You are now the owner")}>
      Become the owner
    </FormButton>
  );
}
