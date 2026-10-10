"use client";

import { useEffect, useState } from "react";
import { LoadingSkeleton } from "@/components/feedback/loading-skeleton";
import { toastNetworkError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { ModalDialog } from "@/components/feedback/modal-dialog";
import { useActionCall } from "@/components/feedback/use-action-call";
import { deleteDocument } from "@/lib/actions/documents";
import { fetchShareCount } from "@/lib/documents/fetch-documents";
import { shareWarning } from "@/lib/documents/presentation";

type DeleteDocumentDialogProps = { id: string; title: string; open: boolean; onClose: () => void; onDeleted: () => void };

// undefined while the count is being read, null when it could not be read.
type Shares = number | null | undefined;

function DeleteBody({ id, onClose, onDeleted }: Omit<DeleteDocumentDialogProps, "title" | "open">) {
  const [shares, setShares] = useState<Shares>(undefined);
  const remove = useActionCall("Could not delete the document");

  useEffect(() => {
    let current = true;
    fetchShareCount(id).then(
      (count) => {
        if (current) setShares(count);
      },
      () => {
        if (!current) return;
        setShares(null);
        toastNetworkError("Could not check where this document is shared");
      },
    );
    return () => {
      current = false;
    };
  }, [id]);

  const warning = shares === undefined ? null : shareWarning(shares);
  return (
    <>
      <p className="text-body leading-relaxed">The file is removed from your passport. This cannot be undone.</p>
      {shares === undefined ? <LoadingSkeleton rows={1} /> : null}
      {warning ? (
        <p role="alert" className="text-body leading-relaxed font-medium">
          {warning}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormButton type="button" variant="secondary" className="w-full" onClick={onClose}>
          Cancel
        </FormButton>
        <FormButton
          type="button"
          variant="destructive"
          disabled={shares === undefined}
          busy={remove.pending}
          onClick={() =>
            remove.run(
              () => deleteDocument(id),
              "Document deleted",
              () => {
                onClose();
                onDeleted();
              },
            )
          }
        >
          Delete document
        </FormButton>
      </div>
    </>
  );
}

export function DeleteDocumentDialog({ id, title, open, onClose, onDeleted }: DeleteDocumentDialogProps) {
  return (
    <ModalDialog open={open} onClose={onClose} title={`Delete ${title}?`}>
      <DeleteBody id={id} onClose={onClose} onDeleted={onDeleted} />
    </ModalDialog>
  );
}
