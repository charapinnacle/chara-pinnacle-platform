"use client";

import { useEffect, useRef } from "react";
import type { FieldPath, FieldValues, UseFormReturn } from "react-hook-form";
import { toastNetworkError } from "@/components/feedback/toast-store";
import { isRedirectError } from "@/lib/redirect-error";

type ServerFormResult = { errors?: Record<string, string>; message?: string };

type Options<TValues extends FieldValues> = {
  failureTitle: string;
  clearOnFailure?: FieldPath<TValues>;
};

// Owns what every form that submits to a Server Action shares: the error summary the focus moves to after each
// submit, the guard against a double submit, the server's field and form errors, and the network-failure toast.
export function useServerFormSubmit<TValues extends FieldValues, TContext, TOutput>(
  form: UseFormReturn<TValues, TContext, TOutput>,
  { failureTitle, clearOnFailure }: Options<TValues>,
) {
  const { formState, resetField, setError } = form;
  const summaryRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (formState.submitCount > 0 && summaryRef.current) summaryRef.current.focus();
  }, [formState.submitCount]);

  async function submit<TResult extends ServerFormResult>(
    call: () => Promise<TResult | undefined>,
    onResult?: (result: TResult) => void,
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await call();
      if (!result) return;
      if (clearOnFailure) resetField(clearOnFailure);
      for (const [path, message] of Object.entries(result.errors ?? {})) {
        setError(path as FieldPath<TValues>, { message });
      }
      if (result.message) setError("root.server", { type: "server", message: result.message });
      onResult?.(result);
    } catch (error) {
      if (isRedirectError(error)) return;
      if (clearOnFailure) resetField(clearOnFailure);
      toastNetworkError(failureTitle);
    } finally {
      inFlight.current = false;
    }
  }

  return { summaryRef, submit };
}
