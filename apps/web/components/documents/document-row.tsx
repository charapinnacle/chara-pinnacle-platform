"use client";

import { useState } from "react";
import { FormButton } from "@/components/forms/form-button";
import { DeleteDocumentDialog } from "@/components/documents/delete-document-dialog";
import { RenameForm } from "@/components/documents/rename-form";
import { useTeamCall } from "@/components/team/use-team-call";
import { getDocumentDownload } from "@/lib/actions/documents";
import { documentStatus, expiryLabel, formatFileSize } from "@/lib/documents/presentation";
import type { DocumentItem } from "@/lib/documents/fetch-documents";
import { formatDate } from "@/lib/i18n/format";
import { documentTypeOptions } from "@/lib/validation/documents";

type DocumentRowProps = { item: DocumentItem; today: string; onChanged: () => void };

const typeLabels: Record<string, string> = Object.fromEntries(documentTypeOptions.map((o) => [o.value, o.label]));

// Each cell prints its own column heading. An empty cell leaves the layout and loses its heading but stays in the
// accessibility tree, so every row keeps one cell per column header.
const labelled =
  "flex items-baseline gap-3 before:w-20 before:shrink-0 before:text-sm before:font-semibold before:text-muted-foreground before:content-[attr(data-label)] empty:sr-only empty:before:content-none";

export function DocumentRow({ item, today, onChanged }: DocumentRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const download = useTeamCall("Could not download the file");
  const status = documentStatus(item.scanStatus, item.checking);
  const expiry = expiryLabel(item.expiresOn, today);

  return (
    <tr role="row" className="grid grid-cols-1 gap-1.5 border-t p-3 first:border-t-0">
      <th role="rowheader" scope="row" className="text-start font-medium break-words">
        {renaming ? (
          <RenameForm
            documentId={item.id}
            title={item.title}
            onDone={(renamed) => {
              setRenaming(false);
              if (renamed) onChanged();
            }}
          />
        ) : (
          item.title
        )}
      </th>
      <td role="cell" data-label="Type" className={labelled}>{typeLabels[item.type]}</td>
      <td role="cell" data-label="Size" className={labelled}>{formatFileSize(item.sizeBytes)}</td>
      <td role="cell" data-label="Uploaded" className={labelled}>{formatDate(item.createdAt)}</td>
      <td role="cell" data-label="Expires" className={labelled}>
        {expiry ?? (item.expiresOn ? formatDate(item.expiresOn) : "")}
      </td>
      <td role="cell" data-label="Status" className={labelled}>{status.label}</td>
      <td role="cell" className="mt-2">
        <div className="flex flex-wrap gap-2">
          {status.usable && !renaming ? (
            <>
              <FormButton
                type="button"
                variant="secondary"
                busy={download.pending}
                onClick={() =>
                  download.run(async () => {
                    const result = await getDocumentDownload(item.id);
                    if (result.url) window.location.assign(result.url);
                    return result;
                  }, "Your download is starting")
                }
              >
                Download<span className="sr-only"> {item.title}</span>
              </FormButton>
              <FormButton type="button" variant="secondary" onClick={() => setRenaming(true)}>
                Rename<span className="sr-only"> {item.title}</span>
              </FormButton>
            </>
          ) : null}
          <FormButton type="button" variant="secondary" onClick={() => setConfirming(true)}>
            Delete<span className="sr-only"> {item.title}</span>
          </FormButton>
        </div>
        <DeleteDocumentDialog
          id={item.id}
          title={item.title}
          open={confirming}
          onClose={() => setConfirming(false)}
          onDeleted={onChanged}
        />
      </td>
    </tr>
  );
}
