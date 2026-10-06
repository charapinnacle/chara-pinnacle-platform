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

export function DocumentRow({ item, today, onChanged }: DocumentRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const download = useTeamCall("Could not download the file");
  const status = documentStatus(item.scanStatus, item.checking);
  const expiry = expiryLabel(item.expiresOn, today);

  return (
    <tr className="border-t align-top">
      <th scope="row" className="min-w-40 px-3 py-3 text-start font-medium break-words">
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
      <td className="px-3 py-3">{typeLabels[item.type]}</td>
      <td className="px-3 py-3 whitespace-nowrap">{formatFileSize(item.sizeBytes)}</td>
      <td className="px-3 py-3 whitespace-nowrap">{formatDate(item.createdAt)}</td>
      <td className="px-3 py-3">{expiry ?? (item.expiresOn ? formatDate(item.expiresOn) : "")}</td>
      <td className="min-w-32 px-3 py-3">{status.label}</td>
      <td className="px-3 py-3">
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
