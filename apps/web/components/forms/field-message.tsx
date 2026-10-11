import { CircleAlert } from "lucide-react";
import { FieldError } from "@/components/ui/field";

type FieldMessageProps = { id: string; error?: { message?: string }; className?: string };

// The error of one field, in the error colour with an icon so that the colour is not the only sign; the control
// points at it with aria-describedby, and it is announced when it appears.
export function FieldMessage({ id, error, className }: FieldMessageProps) {
  if (!error?.message) return null;
  return (
    <FieldError id={id} className={className ?? "flex items-start gap-1.5 text-small leading-snug"}>
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 text-pretty wrap-anywhere">{error.message}</span>
    </FieldError>
  );
}
