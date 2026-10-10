"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast, toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { TextareaField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { addInternalNote } from "@/lib/actions/applicant-review";
import { NOTE_MAX_CHARS, noteInputSchema, type NoteInput } from "@/lib/validation/applicant";

const NOTE_ID = "internal-note-body";

export function NoteForm({ slug, applicationId }: { slug: string; applicationId: string }) {
  const form = useForm<NoteInput>({
    resolver: zodResolver(noteInputSchema),
    defaultValues: { body: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, reset } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The note was not added" });
  const length = useWatch({ control, name: "body" }).length;

  function add(values: NoteInput) {
    return submit(
      () => addInternalNote(slug, applicationId, values),
      (result) => {
        if (result.done) {
          reset();
          toast({ title: "Note added" });
        } else if (result.message) {
          toastError("The note was not added", result.message);
        }
      },
    );
  }

  return (
    <form noValidate className="grid gap-3" onSubmit={handleSubmit(add)}>
      <FormErrorSummary form={form} summaryRef={summaryRef} ids={{ body: NOTE_ID }} />
      <TextareaField
        control={control}
        name="body"
        id={NOTE_ID}
        label="Add an internal note"
        description={`Visible to your organization only. ${length}/${NOTE_MAX_CHARS}`}
      />
      <div>
        <FormButton type="submit" busy={formState.isSubmitting} className="w-full sm:w-auto">
          Add note
        </FormButton>
      </div>
    </form>
  );
}
