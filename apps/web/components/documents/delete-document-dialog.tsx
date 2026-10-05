"use client";

import { useEffect, useState } from "react";
import { toast } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { ModalDialog } from "@/components/team/modal-dialog";
import { useTeamCall } from "@/components/team/use-team-call";
import { deleteDocument } from "@/lib/actions/documents";
import { fetchShareCount } from "@/lib/documents/fetch-documents";
import { shareWarning } from "@/lib/documents/presentation";

const SHARES_UNKNOWN =
  "We could not check whether this document is shared. If it is, deleting it ends the employers' access to all documents shared with it.";

type DeleteDocumentDialogProps = { id: string; title: string; open: boolean; onClose: () => void; onDeleted: () => void };

// undefined while the count is being read, null when it could not be read.
type Shares = number | null | undefined;

function DeleteBody({ id, onClose, onDeleted }: Omit<DeleteDocumentDialogProps, "title" | "open">) {
  const [shares, setShares] = useState<Shares>(undefined);
  const remove = useTeamCall("Could not delete the document");

  useEffect(() => {
    let current = true;
    fetchShareCount(id).then(
      (count) => {
        if (current) setShares(count);
      },
      () => {
        if (!current) return;
        setShares(null);
        toast({ variant: "error", title: "Could not check where this document is shared", description: "Check your connection and try again." });
      },
    );
    return () => {
      current = false;
    };
  }, [id]);

  const warning = typeof shares === "number" ? shareWarning(shares) : shares === null ? SHARES_UNKNOWN : null;
  return (
    <>
      <p className="text-body leading-relaxed">The file is removed from your passport. This cannot be undone.</p>
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
