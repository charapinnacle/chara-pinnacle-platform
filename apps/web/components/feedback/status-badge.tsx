import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const statusBadgeVariants = cva("inline-block rounded-full border px-2 py-0.5 text-small font-medium", {
  variants: {
    status: {
      success: "border-success-border bg-success-background text-success-foreground",
      warning: "border-warning-border bg-warning-background text-warning-foreground",
      danger: "border-danger-border bg-danger-background text-danger-foreground",
      info: "border-info-border bg-info-background text-info-foreground",
      neutral: "border-neutral-border bg-neutral-background text-neutral-foreground",
    },
  },
  defaultVariants: { status: "neutral" },
});

export type StatusTone = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>;

// The label always says the status in words: the colour only helps a reader scan a list, it never carries the meaning.
export function StatusBadge({ status, className, ...props }: React.ComponentProps<"span"> & { status?: StatusTone }) {
  return <span className={cn(statusBadgeVariants({ status }), className)} {...props} />;
}
