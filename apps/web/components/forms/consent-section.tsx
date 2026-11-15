"use client";

import type { Control, FieldPath, FieldValues } from "react-hook-form";
import { StatusBadge } from "@/components/feedback/status-badge";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { LegalLink } from "@/components/forms/text-link";
import { formatDate } from "@/lib/i18n/format";
import { consentVerb, displayTitle, isDraftDocument, type LegalDocumentSummary } from "@/lib/validation/consents";

type ConsentSectionProps<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  id: string;
  document: Pick<LegalDocumentSummary, "slug" | "title" | "version" | "publishedAt"> & { changeSummary?: string };
};

// A document that has to be accepted on a page of its own (the consent page, the checkout): its title, version and date, what
// changed when it is a new version, a link to the full text, and the box that accepts it.
export function ConsentSection<T extends FieldValues>({ control, name, id, document }: ConsentSectionProps<T>) {
  const title = displayTitle(document.title);
  return (
    <section className="grid gap-2 rounded-xl border px-4 pt-3 pb-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="grid gap-0.5">
          <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body font-semibold">
            {title}
            {isDraftDocument(document) ? <StatusBadge className="px-1.5 py-0 text-caption font-medium">Draft</StatusBadge> : null}
          </h2>
          <p className="text-caption text-muted-foreground">
            Version {document.version} · {formatDate(document.publishedAt)}
          </p>
        </div>
        <LegalLink slug={document.slug} newTabLabel={`of the ${title} (opens in a new tab)`} standalone="flush" className="text-small">
          Read the full text
        </LegalLink>
      </div>
      {document.changeSummary ? <p className="text-small text-pretty text-muted-foreground">{document.changeSummary}</p> : null}
      <CheckboxField control={control} name={name} id={id}>
        {consentVerb(document.slug)} {title}
      </CheckboxField>
    </section>
  );
}
