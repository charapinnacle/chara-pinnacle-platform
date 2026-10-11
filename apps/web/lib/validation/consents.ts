import * as z from "zod";

export const AGE_ATTESTATION_SLUG = "age-18-plus";

const consentEntrySchema = z.object({
  purpose: z.string().min(1).max(80),
  version: z.number().int().min(0).max(999_999_999),
});

export const consentEntriesSchema = z.array(consentEntrySchema).max(20);

export type ConsentEntry = z.infer<typeof consentEntrySchema>;

export type LegalDocumentSummary = {
  slug: string;
  title: string;
  version: number;
  publishedAt: string;
  changeSummary: string;
};

const DRAFT_PREFIX = /^DRAFT:\s*/i;

export const AGE_CONFIRMATION = "I confirm that I am at least 18 years old.";

// The stored title keeps its DRAFT: prefix (the legal pages show it); a form shows the plain title and a Draft badge.
export function displayTitle(title: string): string {
  return title.replace(DRAFT_PREFIX, "");
}

export function isDraftDocument(document: Pick<LegalDocumentSummary, "title" | "version">): boolean {
  return document.version === 0 || DRAFT_PREFIX.test(document.title);
}

// The placeholder wording of a draft says that it is a draft; a form shows the plain sentence until counsel's text is published.
export function ageConfirmationLabel(
  document: Pick<LegalDocumentSummary, "title" | "version">,
  wording: string | null,
): string {
  return wording && !isDraftDocument(document) ? wording : AGE_CONFIRMATION;
}

export const DOCUMENT_CHANGED =
  "A legal document has changed. Reload the page to see the current version.";

export function consentMessage(
  document: Pick<LegalDocumentSummary, "slug" | "title">,
): string {
  return document.slug === AGE_ATTESTATION_SLUG
    ? "Confirm that you are 18 or older to create an account"
    : `Accept the ${displayTitle(document.title)} to continue`;
}

export function unacceptedDocuments(
  documents: readonly LegalDocumentSummary[],
  entries: readonly ConsentEntry[],
): LegalDocumentSummary[] {
  return documents.filter(
    (document) =>
      !entries.some(
        (entry) =>
          entry.purpose === document.slug && entry.version === document.version,
      ),
  );
}

export function acceptedSchema(documents: readonly LegalDocumentSummary[]) {
  return z.object(
    Object.fromEntries(
      documents.map((document) => [
        document.slug,
        z
          .boolean({ error: consentMessage(document) })
          .refine(Boolean, { error: consentMessage(document) }),
      ]),
    ),
  );
}
