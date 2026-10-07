import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
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
      },
      busy: {
        true: "disabled:pointer-events-auto disabled:cursor-progress disabled:opacity-100",
        false: "disabled:opacity-60",
      },
    },
    compoundVariants: [
      { variant: "primary", busy: true, className: "disabled:bg-primary-active" },
      { variant: "secondary", busy: true, className: "disabled:bg-secondary" },
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
      className={cn(formButtonVariants({ variant, busy }), className)}
      {...props}
    >
      {busy ? <LoaderCircle aria-hidden className="size-4" /> : null}
      {children}
    </Button>
  );
}
