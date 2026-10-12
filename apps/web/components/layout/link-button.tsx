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

type ButtonLook = VariantProps<typeof linkButtonVariants> & Pick<VariantProps<typeof formButtonVariants>, "variant">;
type LinkButtonProps = React.ComponentProps<typeof Link> & ButtonLook;

// The classes of a link button, also for an element that only shows the look of an action (the "Apply now" of a card
// that is itself the link).
export function linkButtonClassName({ variant, size, className }: ButtonLook & { className?: string }): string {
  return cn(linkButtonVariants({ size }), formButtonVariants({ variant }), "w-auto", className);
}

// A link that looks like a button: for navigation that must read as an action. Use FormButton for anything that submits.
export function LinkButton({ variant, size, className, ...props }: LinkButtonProps) {
  return <Link className={linkButtonClassName({ variant, size, className })} {...props} />;
}
