import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// The one checkbox of the interface: 20 px, a 6 px radius and a 1.5 px neutral border; checked, it is filled near-black with
// a white check. The accent is only for the focus outline of globals.css, which the native input draws. It is kept apart
// from the form fields of checkbox-field.tsx so that the selections of the applicant list, the pipeline and the
// invitations do not load React Hook Form with the page.
export function Checkbox({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return (
    <span className="relative grid size-5 shrink-0 place-items-center">
      <input
        type="checkbox"
        className={cn(
          "peer col-start-1 row-start-1 size-5 cursor-pointer appearance-none rounded-sm border-[1.5px] border-input bg-card transition-colors duration-120 hover:border-muted-foreground checked:border-primary checked:bg-primary aria-invalid:border-destructive aria-invalid:checked:bg-destructive disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none col-start-1 row-start-1 size-3 scale-75 text-primary-foreground opacity-0 transition-[opacity,scale] duration-120 peer-checked:scale-100 peer-checked:opacity-100 peer-disabled:opacity-0 motion-reduce:transition-none"
      />
    </span>
  );
}
