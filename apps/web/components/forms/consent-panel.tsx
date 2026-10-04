import { cn } from "@/lib/utils";

type ConsentPanelProps = React.ComponentProps<"div"> & { as?: "div" | "section" };

export function ConsentPanel({ as: Component = "div", className, ...props }: ConsentPanelProps) {
  return (
    <Component
      className={cn(
        "grid gap-1 rounded-xl border bg-muted p-1 transition-colors has-aria-invalid:border-destructive has-aria-invalid:bg-destructive-surface sm:p-1.5",
        className,
      )}
      {...props}
    />
  );
}
