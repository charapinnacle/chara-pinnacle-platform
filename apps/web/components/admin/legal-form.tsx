"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm, type FieldPath } from "react-hook-form";
import { summaryItems } from "@/components/admin/summary-items";
import { toast } from "@/components/feedback/toast-store";
import { ErrorSummary } from "@/components/forms/error-summary";
import { FormButton } from "@/components/forms/form-button";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { publishLegalDocument } from "@/lib/actions/admin-staff";
import { defaultLocale } from "@/lib/i18n/locale";
import { adminPath } from "@/lib/routes";
import { legalDocumentSchema, type LegalDocumentForm } from "@/lib/validation/admin";

const ids = { slug: "legal-slug", title: "legal-title", body: "legal-body", changeSummary: "legal-summary" } as const;

export function LegalForm({ slug, title, expectedVersion }: { slug: string; title: string; expectedVersion: number }) {
  const router = useRouter();
  const form = useForm<LegalDocumentForm>({
    resolver: zodResolver(legalDocumentSchema),
    defaultValues: { expectedVersion, slug, title, body: "", changeSummary: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, reset } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The document was not published" });

  function onSubmit(values: LegalDocumentForm) {
    return submit(
      () => publishLegalDocument(values),
      (result) => {
        if (!result.done) return;
        reset({ expectedVersion: 0, slug: "", title: "", body: "", changeSummary: "" });
        toast({ title: `Version ${result.version} of ${values.slug} is published` });
        router.replace(adminPath(defaultLocale, "legal"));
        router.refresh();
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <ErrorSummary
        ref={summaryRef}
        items={summaryItems(formState.errors, ids)}
        onSelect={(key) => form.setFocus(key as FieldPath<LegalDocumentForm>)}
      />
      <InputField
        control={control}
        name="slug"
        id={ids.slug}
        label="Document name"
        description="Lower-case letters, digits and hyphens, for example privacy-policy. A new name starts at version 1."
        autoComplete="off"
        maxLength={60}
      />
      <InputField control={control} name="title" id={ids.title} label="Title" autoComplete="off" maxLength={200} />
      <TextareaField control={control} name="body" id={ids.body} label="Text of the document" />
      <TextareaField
        control={control}
        name="changeSummary"
        id={ids.changeSummary}
        label="Change summary"
        description="Required, 10 to 1000 characters. Everyone who has to accept the document is emailed this and must accept it at the next sign-in."
      />
      <div>
        <FormButton type="submit" busy={formState.isSubmitting} className="w-full sm:w-auto">
          Publish new version
        </FormButton>
      </div>
    </form>
  );
}
