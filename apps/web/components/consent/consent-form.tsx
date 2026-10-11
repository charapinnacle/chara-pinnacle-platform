"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { toastNetworkError } from "@/components/feedback/toast-store";
import { ConsentCheckbox } from "@/components/forms/consent-checkbox";
import { ConsentList } from "@/components/forms/consent-list";
import { ConsentSection } from "@/components/forms/consent-section";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import type { ConsentActionResult } from "@/lib/actions/consents";
import { isRedirectError } from "@/lib/redirect-error";
import {
  acceptedSchema,
  AGE_ATTESTATION_SLUG,
  type ConsentEntry,
  type LegalDocumentSummary,
} from "@/lib/validation/consents";

type ConsentFormProps = {
  documents: LegalDocumentSummary[];
  attestationWording: string | null;
  submitLabel: string;
  onAccept: (entries: ConsentEntry[]) => Promise<ConsentActionResult>;
};

function formSchema(documents: readonly LegalDocumentSummary[]) {
  return z.object({ accepted: acceptedSchema(documents) });
}

type FormInput = z.input<ReturnType<typeof formSchema>>;

function checkboxId(slug: string) {
  return `consent-${slug}`;
}

export function ConsentForm({
  documents,
  attestationWording,
  submitLabel,
  onAccept,
}: ConsentFormProps) {
  const form = useForm<FormInput, undefined, z.output<ReturnType<typeof formSchema>>>({
    resolver: zodResolver(formSchema(documents)),
    defaultValues: {
      accepted: Object.fromEntries(documents.map((document) => [document.slug, false])),
    },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, setError } = form;
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (formState.submitCount > 0 && summaryRef.current) summaryRef.current.focus();
  }, [formState.submitCount]);

  const ids = Object.fromEntries(documents.map((document) => [`accepted.${document.slug}`, checkboxId(document.slug)]));

  async function onSubmit(values: { accepted: Record<string, boolean> }) {
    try {
      const result = await onAccept(
        documents
          .filter((document) => values.accepted[document.slug])
          .map((document) => ({ purpose: document.slug, version: document.version })),
      );
      if (result) setError("root.server", { message: result.error });
    } catch (error) {
      if (isRedirectError(error)) return;
      toastNetworkError("Could not save your answer");
    }
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={ids} />
      <ConsentList>
        {documents.map((document) =>
          document.slug === AGE_ATTESTATION_SLUG ? (
            <ConsentCheckbox
              key={document.slug}
              control={control}
              name={`accepted.${document.slug}`}
              id={checkboxId(document.slug)}
              document={document}
              attestationWording={attestationWording}
            />
          ) : (
            <ConsentSection
              key={document.slug}
              control={control}
              name={`accepted.${document.slug}`}
              id={checkboxId(document.slug)}
              document={document}
            />
          ),
        )}
      </ConsentList>
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Saving..." : submitLabel}
      </FormButton>
    </form>
  );
}
