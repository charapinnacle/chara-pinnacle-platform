"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type DefaultValues, type FieldValues } from "react-hook-form";
import type * as z from "zod";
import { toast, toastError } from "@/components/feedback/toast-store";
import { useServerFormSubmit } from "@/components/forms/use-server-form-submit";
import type { PassportResult } from "@/lib/actions/passport";

type Options = { failureTitle: string; saved: string; resetOnSuccess?: boolean; onSaved?: () => void };

// What every passport section form shares: the schema as resolver, one submit at a time, the server's refusals as field
// errors or an error toast, and a toast that says what was saved. A form that adds an item starts again afterwards; a
// form in a dialog closes it (onSaved) before the toast, which a modal would otherwise keep out of reach.
export function usePassportForm<TInput extends FieldValues>(
  schema: z.ZodType<TInput, TInput>,
  defaultValues: DefaultValues<TInput>,
  save: (values: TInput) => Promise<PassportResult>,
  { failureTitle, saved, resetOnSuccess = false, onSaved }: Options,
) {
  const form = useForm<TInput>({ resolver: zodResolver(schema), defaultValues });
  const { submit } = useServerFormSubmit(form, { failureTitle });

  const onSubmit = form.handleSubmit(() =>
    submit(
      () => save(form.getValues()),
      (result) => {
        if (result.message) {
          toastError(failureTitle, result.message);
        } else if (!result.errors) {
          onSaved?.();
          toast({ title: saved });
          if (resetOnSuccess) form.reset();
        }
      },
    ),
  );

  return { form, onSubmit };
}
