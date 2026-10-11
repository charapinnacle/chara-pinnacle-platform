import { ChevronDown } from "lucide-react";
import { controlClassName } from "@/components/forms/control-class";
import { cn } from "@/lib/utils";

// The size, inset and chevron of a text input and of the combobox, around a native select. It is apart from select-field.tsx
// so that a select outside a React Hook Form field does not pull the form libraries in.
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        className={cn(controlClassName, "h-12 w-full min-w-0 appearance-none border ps-4 pe-11", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute end-4 top-4 size-4 text-muted-foreground" />
    </div>
  );
}
