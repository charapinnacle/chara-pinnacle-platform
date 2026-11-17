"use client";

import { FileText } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "@/components/feedback/status-badge";
import { toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { openResponseDocument } from "@/lib/actions/responses";
import type { ResponseDocument } from "@/lib/dal/responses";
import { formatFileSize } from "@/lib/documents/presentation";

// The documents of a response in its read view (FR-O2 AC6): Open asks for a 60-second link and the browser saves the file;
// the database logs each opening. The partner also sees a file still being checked or refused by the scan; the employer
// reads the scanned ones only.
export function ResponseDocumentList({ slug, documents }: { slug: string; documents: ResponseDocument[] }) {
  const [opening, setOpening] = useState<string | null>(null);

  async function open(document: ResponseDocument) {
    setOpening(document.id);
    const result = await openResponseDocument(slug, document.id).catch(() => ({ message: "The document could not be opened. Try again.", url: undefined }));
    setOpening(null);
    if (result.url) {
      window.location.assign(result.url);
      return;
    }
    toastError("The document could not be opened", result.message);
  }

  if (documents.length === 0) return <p className="text-small text-muted-foreground">No supporting documents.</p>;
  return (
    <ul className="grid gap-2" aria-label="Supporting documents">
      {documents.map((document) => {
        const ready = document.scanStatus === "skipped" || document.scanStatus === "clean";
        return (
          <li key={document.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border bg-card p-3">
            <span className="flex min-w-0 items-center gap-2">
              <FileText aria-hidden className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 break-words">
                {document.fileName} <span className="text-small text-muted-foreground">({formatFileSize(document.sizeBytes)})</span>
              </span>
            </span>
            {ready ? (
              <FormButton type="button" variant="secondary" className="w-auto" busy={opening === document.id} onClick={() => open(document)}>
                Open<span className="sr-only normal-case"> {document.fileName}</span>
              </FormButton>
            ) : (
              <StatusBadge status={document.scanStatus === "rejected" ? "danger" : "info"}>
                {document.scanStatus === "rejected" ? "Refused: not a valid PDF" : "Being checked"}
              </StatusBadge>
            )}
          </li>
        );
      })}
    </ul>
  );
}
