import { Notice } from "@/components/forms/notice";
import { isDraftDocument, type LegalDocumentSummary } from "@/lib/validation/consents";
import type { AccountChoice } from "@/lib/validation/sign-up";

// FR-S4: until counsel approves them, the partner documents are drafts; a partner choice says so above the boxes that
// accept them. The worker and employer choices keep their Phase 1 look (a Draft badge per document only).
export function PartnerDraftNotice({ choice, documents }: { choice: AccountChoice; documents: readonly LegalDocumentSummary[] }) {
  if (choice === "worker" || choice === "company" || !documents.some(isDraftDocument)) return null;
  return (
    <Notice role="note" tone="info">
      Draft - not yet approved by legal counsel. Some of the partner documents below are drafts; you accept the version shown.
    </Notice>
  );
}
