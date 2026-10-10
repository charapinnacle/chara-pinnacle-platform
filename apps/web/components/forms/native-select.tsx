import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// The size, inset and chevron of a text input and of the combobox, around a native select. It is apart from select-field.tsx
// so that a select outside a React Hook Form field does not pull the form libraries in.
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-11 w-full min-w-0 appearance-none rounded-lg border border-input bg-card ps-3.5 pe-10 text-base text-foreground transition-colors hover:border-muted-foreground aria-invalid:border-destructive",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute end-3 top-3.5 size-4 text-muted-foreground" />
    </div>
  );
}
