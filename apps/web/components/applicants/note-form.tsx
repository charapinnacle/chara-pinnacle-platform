"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "@/components/feedback/toast-store";
import { ErrorSummary } from "@/components/forms/error-summary";
import { FormButton } from "@/components/forms/form-button";
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
  const error = formState.errors.body?.message;

  function add(values: NoteInput) {
    return submit(
      () => addInternalNote(slug, applicationId, values),
      (result) => {
        if (result.done) {
          reset();
          toast({ title: "Note added" });
        } else if (result.message) {
          toast({ variant: "error", title: "The note was not added", description: result.message });
        }
      },
    );
  }

  return (
    <form noValidate className="grid gap-3" onSubmit={handleSubmit(add)}>
      <ErrorSummary
        ref={summaryRef}
        items={error ? [{ key: "body", message: error, targetId: NOTE_ID }] : []}
        onSelect={() => form.setFocus("body")}
      />
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
