import Link from "next/link";
import { cn } from "@/lib/utils";

// A link that looks like the primary form button, for a step that is a page of its own (the apply form).
export function LinkButton({ className, ...props }: React.ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        "inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-transparent bg-primary px-6 text-base font-semibold whitespace-nowrap text-primary-foreground shadow-xs transition-[background-color,box-shadow] hover:bg-primary-hover hover:shadow-sm active:bg-primary-active",
        className,
      )}
      {...props}
    />
  );
}
