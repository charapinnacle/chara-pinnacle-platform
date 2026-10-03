import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pageContainerVariants = cva("mx-auto w-full px-4 sm:px-6", {
  variants: {
    size: {
      narrow: "max-w-md",
      default: "max-w-6xl",
    },
  },
  defaultVariants: { size: "default" },
});

export function PageContainer({
  size,
  className,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof pageContainerVariants>) {
  return (
    <div
      className={cn(pageContainerVariants({ size }), className)}
      {...props}
    />
  );
}
