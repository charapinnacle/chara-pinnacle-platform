import { READ_ONLY_REASON_ID } from "@/components/billing/read-only-plan";
import { FormButton } from "@/components/forms/form-button";
import { cn } from "@/lib/utils";

// A control the plan does not allow. It is aria-disabled and not disabled, so that it stays in the tab order and a screen
// reader announces the reason it points to; it has no handler, so activating it does nothing.
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
