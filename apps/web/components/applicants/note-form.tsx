"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast, toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { TextareaField } from "@/components/forms/form-field";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import type { ReviewSubject } from "@/components/applicants/review-subject";
import { addInternalNote } from "@/lib/actions/applicant-review";
import { addSubmissionInternalNote } from "@/lib/actions/submission-pipeline";
import { characterCount } from "@/lib/i18n/format";
import { NOTE_MAX_CHARS, noteInputSchema, type NoteInput } from "@/lib/validation/applicant";
import { SUBMISSION_NOTE_MAX_CHARS, submissionNoteInputSchema } from "@/lib/validation/submission-pipeline";

const NOTE_ID = "internal-note-body";

// A submitted candidate's note may be longer (submission_notes.body, FR-O5) and is hidden from the partner as well.
export function NoteForm({ slug, subject, visibility }: { slug: string; subject: ReviewSubject; visibility: string }) {
  const submission = subject.kind === "submission";
  const maxChars = submission ? SUBMISSION_NOTE_MAX_CHARS : NOTE_MAX_CHARS;
  const form = useForm<NoteInput>({
    resolver: zodResolver(submission ? submissionNoteInputSchema : noteInputSchema),
    defaultValues: { body: "" },
    shouldFocusError: false,
  });
  const { control, formState, handleSubmit, reset } = form;
  const { summaryRef, submit } = useServerFormSubmit(form, { failureTitle: "The note was not added" });
  const length = useWatch({ control, name: "body" }).length;

  function add(values: NoteInput) {
    return submit(
      () => (submission ? addSubmissionInternalNote(slug, subject.id, values) : addInternalNote(slug, subject.id, values)),
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
        description={`${visibility} ${characterCount(length, maxChars)}.`}
      />
      <div>
        <FormButton type="submit" busy={formState.isSubmitting} className="w-full sm:w-auto">
          Add note
        </FormButton>
      </div>
    </form>
  );
}
