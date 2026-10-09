import { READ_ONLY_REASON_ID } from "@/components/billing/read-only-plan";
import { FormButton } from "@/components/forms/form-button";
import { cn } from "@/lib/utils";

// aria-disabled rather than disabled, so that the control stays focusable and the reason is announced.
export function ReadOnlyButton({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <FormButton
      type="button"
      aria-disabled="true"
      aria-describedby={READ_ONLY_REASON_ID}
      className={cn("aria-disabled:cursor-not-allowed aria-disabled:opacity-60", className)}
    >
      {children}
    </FormButton>
  );
}
