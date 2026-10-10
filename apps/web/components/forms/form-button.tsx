import { cva, type VariantProps } from "class-variance-authority";
import { Spinner } from "@/components/feedback/spinner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const formButtonVariants = cva(
  "font-semibold shadow-xs transition-[background-color,box-shadow] hover:shadow-sm focus-visible:ring-0",
  {
    variants: {
      variant: {
        primary: "w-full hover:bg-primary-hover active:bg-primary-active",
        secondary:
          "border-input bg-card text-secondary-foreground hover:bg-secondary active:bg-muted",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive-hover active:bg-destructive-active",
      },
      busy: {
        true: "disabled:pointer-events-auto disabled:cursor-progress disabled:opacity-100",
        false: "disabled:opacity-60",
      },
    },
    compoundVariants: [
      { variant: "primary", busy: true, className: "disabled:bg-primary-active" },
      { variant: "secondary", busy: true, className: "disabled:bg-secondary" },
      { variant: "destructive", busy: true, className: "disabled:bg-destructive-active" },
    ],
    defaultVariants: { variant: "primary", busy: false },
  },
);

type FormButtonProps = Omit<React.ComponentProps<typeof Button>, "size"> &
  Pick<VariantProps<typeof formButtonVariants>, "variant"> & {
    busy?: boolean;
  };

export function FormButton({
  variant,
  busy = false,
  disabled,
  className,
  children,
  ...props
}: FormButtonProps) {
  return (
    <Button
      size="lg"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      // A long label ("Save experience and availability") wraps instead of making its card, and so the page, wider than
      // a 320 or 360 px screen; min-h-11 keeps the 44 px target of a one-line button.
      className={cn("h-auto min-h-11 py-2.5 text-center whitespace-normal", formButtonVariants({ variant, busy }), className)}
      {...props}
    >
      {busy ? <Spinner /> : null}
      {children}
    </Button>
  );
}
