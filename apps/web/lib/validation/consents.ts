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

export const DOCUMENT_CHANGED =
  "A legal document has changed. Reload the page to see the current version.";

export function consentMessage(
  document: Pick<LegalDocumentSummary, "slug" | "title">,
): string {
  return document.slug === AGE_ATTESTATION_SLUG
    ? "Confirm that you are 18 or older to create an account"
    : `Accept the ${document.title} to continue`;
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
