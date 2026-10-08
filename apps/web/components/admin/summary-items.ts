import { get, type FieldError, type FieldErrors, type FieldPath, type FieldValues } from "react-hook-form";
import type { ErrorSummaryItem } from "@/components/forms/error-summary";

// The entries of the error summary of a form: one for each named field that has an error, linked to its input, and the
// refusal the server gave for the form as a whole.
export function summaryItems<T extends FieldValues>(
  errors: FieldErrors<T>,
  ids: Partial<Record<FieldPath<T>, string>>,
): ErrorSummaryItem[] {
  const items: ErrorSummaryItem[] = [];
  for (const [name, targetId] of Object.entries(ids)) {
    const error: FieldError | undefined = get(errors, name);
    if (error?.message) items.push({ key: name, message: error.message, targetId: String(targetId) });
  }
  const server = errors.root?.server;
  if (server?.message) items.push({ key: "root", message: server.message });
  return items;
}
