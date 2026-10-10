"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { CheckboxField } from "@/components/forms/checkbox-field";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { InputField, TextareaField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { publishLegalDocument } from "@/lib/actions/admin-staff";
import { defaultLocale } from "@/lib/i18n/locale";
import { adminPath } from "@/lib/routes";
import { legalDocumentSchema, type LegalDocumentForm } from "@/lib/validation/admin";

const ids = { slug: "legal-slug", title: "legal-title", body: "legal-body", changeSummary: "legal-summary", isDraft: "legal-draft" } as const;

export function LegalForm({ slug, title }: { slug: string; title: string }) {
  const router = useRouter();
  const form = useForm<LegalDocumentForm>({
    resolver: zodResolver(legalDocumentSchema),
    defaultValues: { slug, title, body: "", changeSummary: "", isDraft: false },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, reset } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The document was not published" });

  function onSubmit(values: LegalDocumentForm) {
    return submit(
      () => publishLegalDocument(values),
      (result) => {
        if (!result.done) return;
        reset({ slug: "", title: "", body: "", changeSummary: "", isDraft: false });
        toast({ title: `Published version ${result.version}`, description: `Document ${values.slug}` });
        router.replace(adminPath(defaultLocale, "legal"));
        router.refresh();
      },
    );
  }

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={ids} />
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
        description="Required, 10 to 1000 characters. Everyone who accepted the document is emailed this and must accept the new version at the next sign-in."
      />
      <CheckboxField control={control} name="isDraft" id={ids.isDraft}>
        This text is a draft: legal counsel has not approved it yet. The page shows a draft banner. A draft becomes the current version at once and asks everyone who accepted the document to accept it again, so publish drafts only for documents nobody has accepted yet.
      </CheckboxField>
      <div>
        <FormButton type="submit" busy={formState.isSubmitting} className="w-full sm:w-auto">
          Publish new version
        </FormButton>
      </div>
    </form>
  );
}
