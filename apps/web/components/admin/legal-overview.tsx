import { StatusBadge } from "@/components/feedback/status-badge";
import { TextLink } from "@/components/forms/text-link";
import { Card } from "@/components/layout/card";
import type { LegalDocumentRow } from "@/lib/dal/admin";

// The current version of each legal document, a draft marked as such, linking to the page where versions are published.
export function LegalOverview({ documents, href }: { documents: readonly LegalDocumentRow[]; href: string }) {
  return (
    <Card as="section" aria-labelledby="legal-overview-heading" padding="lg" elevated className="content-start gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="legal-overview-heading" className="text-h2">
          Legal documents
        </h2>
        <TextLink href={href} className="text-small">
          Manage legal documents
        </TextLink>
      </div>
      <ul className="grid">
        {documents.map((document) => (
          <li key={document.slug} className="flex items-center justify-between gap-4 border-t py-2.5 first:border-t-0">
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate text-body font-medium">{document.title}</span>
              <span className="text-caption text-muted-foreground">Version {document.version}</span>
            </span>
            <StatusBadge status={document.isDraft ? "warning" : "success"}>{document.isDraft ? "Draft" : "Published"}</StatusBadge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
