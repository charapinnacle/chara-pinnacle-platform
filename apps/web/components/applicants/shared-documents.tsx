import { OpenDocumentButton } from "@/components/applicants/open-document-button";
import { EmptyState } from "@/components/feedback/empty-state";
import { Notice } from "@/components/forms/notice";
import type { SharedDocument } from "@/lib/dal/applicant-review";
import { expiryLabel, formatFileSize } from "@/lib/documents/presentation";
import { formatDate } from "@/lib/i18n/format";
import { documentTypeOptions } from "@/lib/validation/documents";

type SharedDocumentsProps = {
  slug: string;
  applicationId: string;
  documents: SharedDocument[];
  shareEnded: boolean;
  today: string;
};

const typeLabels: Record<string, string> = Object.fromEntries(documentTypeOptions.map((option) => [option.value, option.label]));

// The documents of the share, never a storage path or a link: a link is asked for when a member presses Open.
export function SharedDocuments({ slug, applicationId, documents, shareEnded, today }: SharedDocumentsProps) {
  return (
    <section aria-labelledby="documents-heading" className="grid gap-3">
      <h2 id="documents-heading" className="text-h2">
        Documents
      </h2>
      {shareEnded ? (
        <Notice tone="info" role="status">
          This document is no longer available. The candidate no longer shares documents with this application.
        </Notice>
      ) : documents.length === 0 ? (
        <EmptyState title="No documents were shared" description="The candidate applied without sharing a CV or a certificate." />
      ) : (
        <ul className="grid gap-2">
          {documents.map((document) => {
            const expiry = expiryLabel(document.expiresOn, today);
            return (
              <li key={document.id} className="grid gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="grid min-w-0 gap-0.5">
                  <p className="font-medium wrap-anywhere">{document.title}</p>
                  <p className="text-small text-muted-foreground wrap-anywhere">
                    {typeLabels[document.type]} · {document.fileName} · {formatFileSize(document.sizeBytes)}
                    {document.expiresOn ? ` · ${expiry ?? `Expires ${formatDate(document.expiresOn)}`}` : ""}
                  </p>
                </div>
                {document.available ? (
                  <OpenDocumentButton slug={slug} applicationId={applicationId} documentId={document.id} title={document.title} />
                ) : (
                  <p className="text-small text-muted-foreground">The file is still being checked</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
