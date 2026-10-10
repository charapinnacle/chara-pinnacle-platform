import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const cardVariants = cva("grid gap-3 rounded-xl border bg-card", {
  variants: {
    padding: { none: "", sm: "p-card-sm", md: "p-card", lg: "p-card-lg" },
    elevated: { true: "shadow-card", false: "" },
  },
  defaultVariants: { padding: "md", elevated: false },
});

type CardProps = React.HTMLAttributes<HTMLElement> &
  VariantProps<typeof cardVariants> & {
    as?: "div" | "section" | "article" | "li";
  };

// The one bordered surface of the interface. The padding comes from the card scale and the optional shadow is the
// single elevation; the layout between the slots is a grid with a 0.75 rem gap that className can change.
export function Card({ as: Tag = "div", padding, elevated, className, ...props }: CardProps) {
  return <Tag className={cn(cardVariants({ padding, elevated }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-1", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-2", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-center gap-x-6 gap-y-2", className)} {...props} />;
}
