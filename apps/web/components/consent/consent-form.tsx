"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { z } from "zod";
import { toast } from "@/components/feedback/toast-store";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { ConsentPanel } from "@/components/forms/consent-panel";
import { FormButton } from "@/components/forms/form-button";
import { ErrorSummary, type ErrorSummaryItem } from "@/components/forms/error-summary";
import { LegalLink } from "@/components/forms/text-link";
import type { ConsentActionResult } from "@/lib/actions/consents";
import { formatDate } from "@/lib/i18n/format";
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

  const items: ErrorSummaryItem[] = documents.flatMap((document) => {
    const error = formState.errors.accepted?.[document.slug];
    return error
      ? [
          {
            key: `accepted.${document.slug}`,
            message: String(error.message),
            targetId: checkboxId(document.slug),
          },
        ]
      : [];
  });
  if (formState.errors.root?.server) {
    items.push({ key: "root", message: String(formState.errors.root.server.message) });
  }

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
      toast({
        variant: "error",
        title: "Could not save your answer",
        description: "Check your connection and try again.",
      });
    }
  }

  return (
    <form noValidate className="grid gap-6" onSubmit={handleSubmit(onSubmit)}>
      <ErrorSummary
        ref={summaryRef}
        items={items}
        onSelect={(key) => form.setFocus(key as FieldPath<FormInput>)}
      />
      {documents.map((document) => (
        <ConsentPanel as="section" key={document.slug}>
          {document.slug === AGE_ATTESTATION_SLUG ? null : (
            <div className="grid gap-1.5 px-2.5 pt-2.5 pb-1 sm:px-3 sm:pt-3">
              <h2 className="text-base font-semibold tracking-tight">{document.title}</h2>
              <p className="text-sm text-muted-foreground">
                Version {document.version}, published {formatDate(document.publishedAt)}
              </p>
              <p className="text-sm leading-relaxed">{document.changeSummary}</p>
              <p className="text-sm">
                <LegalLink
                  slug={document.slug}
                  newTabLabel={`of the ${document.title} (opens in a new tab)`}
                >
                  Read the full text
                </LegalLink>
              </p>
            </div>
          )}
          <CheckboxField
            control={control}
            name={`accepted.${document.slug}`}
            id={checkboxId(document.slug)}
          >
            {document.slug === AGE_ATTESTATION_SLUG
              ? (attestationWording ?? "I am 18 or older")
              : `I accept the ${document.title}`}
          </CheckboxField>
        </ConsentPanel>
      ))}
      <FormButton type="submit" busy={formState.isSubmitting}>
        {formState.isSubmitting ? "Saving..." : submitLabel}
      </FormButton>
    </form>
  );
}
