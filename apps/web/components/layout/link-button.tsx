import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import { formButtonVariants } from "@/components/forms/form-button";
import { cn } from "@/lib/utils";

// The sizes and the base of the Button primitive, which does not export them; the variants are those of FormButton.
const linkButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-primary text-small font-medium whitespace-nowrap text-primary-foreground transition-colors select-none hover:bg-primary/80",
  {
    variants: { size: { default: "h-9 px-4", lg: "h-11 px-6 text-base" } },
    defaultVariants: { size: "lg" },
  },
);

type LinkButtonProps = React.ComponentProps<typeof Link> &
  VariantProps<typeof linkButtonVariants> &
  Pick<VariantProps<typeof formButtonVariants>, "variant">;

// A link that looks like a button: for navigation that must read as an action. Use FormButton for anything that submits.
export function LinkButton({ variant, size, className, ...props }: LinkButtonProps) {
  return (
    <Link
      className={cn(linkButtonVariants({ size }), formButtonVariants({ variant }), "w-auto", className)}
      {...props}
    />
  );
}
