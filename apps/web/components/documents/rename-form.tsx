"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId } from "react";
import { useForm } from "react-hook-form";
import { toast, toastError } from "@/components/feedback/toast-store";
import { FormButton } from "@/components/forms/form-button";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import { Input } from "@/components/ui/input";
import { renameDocument } from "@/lib/actions/documents";
import { renameFormSchema, type RenameInput } from "@/lib/validation/documents";

type RenameFormProps = { documentId: string; title: string; onDone: (renamed: boolean) => void };

// Enter saves, Escape (or Cancel) keeps the old title. A refused title shows its message beside the field.
export function RenameForm({ documentId, title, onDone }: RenameFormProps) {
  const form = useForm<RenameInput>({ resolver: zodResolver(renameFormSchema), defaultValues: { title } });
  const { submit } = useServerFormSubmit(form, { failureTitle: "Could not rename the document" });
  const errorId = useId();
  const { setFocus, formState } = form;
  const error = formState.errors.title?.message;

  useEffect(() => setFocus("title", { shouldSelect: true }), [setFocus]);

  const onSubmit = form.handleSubmit(() =>
    submit(
      () => renameDocument(documentId, form.getValues()),
      (result) => {
        if (result.message) {
          toastError("Could not rename the document", result.message);
        } else if (!result.errors) {
          toast({ title: "Document renamed" });
          onDone(true);
        }
      },
    ),
  );

  return (
    <form noValidate className="grid gap-2" onSubmit={onSubmit}>
      <Input
        {...form.register("title")}
        aria-label={`New title for ${title}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="h-11 bg-card px-3.5 text-base md:text-base"
        onKeyDown={(event) => {
          if (event.key === "Escape") onDone(false);
        }}
      />
      {error ? (
        <p id={errorId} className="text-small text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <FormButton type="submit" busy={formState.isSubmitting}>
          Save
        </FormButton>
        <FormButton type="button" variant="secondary" onClick={() => onDone(false)}>
          Cancel
        </FormButton>
      </div>
    </form>
  );
}
