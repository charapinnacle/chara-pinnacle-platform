"use client";

import type { Control, FieldPath, FieldValues } from "react-hook-form";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { LegalLink } from "@/components/forms/text-link";
import { StatusBadge } from "@/components/feedback/status-badge";
import { formatDate } from "@/lib/i18n/format";
import {
  AGE_ATTESTATION_SLUG,
  ageConfirmationLabel,
  displayTitle,
  isDraftDocument,
  type LegalDocumentSummary,
} from "@/lib/validation/consents";

type ConsentCheckboxProps<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  id: string;
  document: LegalDocumentSummary;
  attestationWording: string | null;
};

// One required consent of the sign-up form: the sentence with the title as a link to the document, and under it the
// version, the date and, for a placeholder text, a Draft badge. The age confirmation is one sentence.
export function ConsentCheckbox<T extends FieldValues>({
  control,
  name,
  id,
  document,
  attestationWording,
}: ConsentCheckboxProps<T>) {
  if (document.slug === AGE_ATTESTATION_SLUG) {
    return (
      <CheckboxField control={control} name={name} id={id} className="py-3.5">
        {ageConfirmationLabel(document, attestationWording)}
      </CheckboxField>
    );
  }
  return (
    <CheckboxField
      control={control}
      name={name}
      id={id}
      className="py-3.5"
      meta={
        <>
          <span>
            Version {document.version} · {formatDate(document.publishedAt)}
          </span>
          {isDraftDocument(document) ? <StatusBadge className="px-1.5 py-0 text-caption">Draft</StatusBadge> : null}
        </>
      }
    >
      <span>
        I accept the{" "}
        <LegalLink slug={document.slug} newTabLabel="(opens in a new tab)" tone="plain" className="relative z-10">
          {displayTitle(document.title)}
        </LegalLink>
      </span>
    </CheckboxField>
  );
}
